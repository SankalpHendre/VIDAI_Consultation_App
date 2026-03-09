import re
import traceback
from datetime import datetime, timedelta

from django.contrib.auth import authenticate
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from medical_consultation.settings import *          # noqa: F401,F403
from .models import Clinic, DoctorAvailability, Meeting, User
from .serializers import (
    DoctorAvailabilitySerializer,
    MeetingSerializer,
    UserSerializer,
)
from .services import create_patient


# =============================================================================
# TRANSCRIPT HELPERS
# =============================================================================

_SPEAKER_PATTERN = re.compile(
    r'(?=(?:Doctor|Patient|Sales)\s*\([^)]+\)\s*:)',
    re.IGNORECASE,
)


def _format_transcript(raw: str) -> str:
    """Split a raw blob into clean one-turn-per-line script."""
    if not raw:
        return ""
    turns = _SPEAKER_PATTERN.split(raw)
    return "\n".join(t.strip() for t in turns if t.strip())


def _append_transcript_line(existing: str, new_line: str) -> str:
    DEDUP_WINDOW = 30   # compare against the last N stored lines

    fmt_new = _format_transcript(new_line) if new_line else ""
    if not fmt_new:
        return existing or ""

    fmt_existing = _format_transcript(existing) if existing else ""
    if not fmt_existing:
        return fmt_new

    existing_lines = [l for l in fmt_existing.split("\n") if l.strip()]
    new_lines      = [l for l in fmt_new.split("\n")      if l.strip()]

    # Build the recent-window set (last DEDUP_WINDOW lines already stored)
    recent = set(existing_lines[-DEDUP_WINDOW:])

    to_add  = []
    in_batch = set()   # also dedup within the incoming batch itself
    for line in new_lines:
        if line not in recent and line not in in_batch:
            to_add.append(line)
            in_batch.add(line)
            recent.add(line)   # keep window fresh as we add

    if not to_add:
        return fmt_existing

    return fmt_existing + "\n" + "\n".join(to_add)


# =============================================================================
# MEETING WINDOW HELPERS
# =============================================================================

def _meeting_active_start(meeting):
    return meeting.scheduled_time - timedelta(minutes=5)


def _meeting_expiry(meeting):
    return meeting.scheduled_time + timedelta(minutes=(meeting.duration or 30))


def _expire_stale_meetings():
    now    = timezone.now()
    active = Meeting.objects.filter(status__in=["scheduled", "started"])
    to_end = [m.pk for m in active if now > _meeting_expiry(m)]
    if to_end:
        Meeting.objects.filter(pk__in=to_end).update(status="ended")


def _get_meeting_by_key(meeting_key, select_related=None):
    """Resolve a meeting by numeric PK or by room_id (UUID string).

    Some parts of the frontend route via the room UUID (e.g. "meet-..."),
    while others may still reference the integer primary key.

    Args:
        meeting_key: either an integer/str meeting_id or the string room_id.
        select_related: optional iterable of related fields to eager-load.
    """
    if not meeting_key:
        return None

    qs = Meeting.objects
    if select_related:
        qs = qs.select_related(*select_related)

    # If the caller passed the real room UUID (e.g. "meet-xxx"), try that first
    if isinstance(meeting_key, str) and meeting_key.startswith("meet-"):
        meeting = qs.filter(room_id=meeting_key).first()
        if meeting:
            return meeting

    # Fall back to numeric meeting_id
    try:
        return qs.get(meeting_id=int(meeting_key))
    except (ValueError, TypeError, Meeting.DoesNotExist):
        pass

    # Finally, try room_id for non-prefixed strings (older clients?)
    if isinstance(meeting_key, str):
        return qs.filter(room_id=meeting_key).first()

    return None


def _get_meeting_or_404(meeting_key):
    meeting = _get_meeting_by_key(meeting_key)
    if not meeting:
        raise Http404("Meeting not found")
    return meeting


# =============================================================================
# AUTH
# =============================================================================

class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        user = authenticate(username=username, password=password)
        if user is None:
            return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        role = "admin" if user.is_superuser else user.role
        refresh = RefreshToken.for_user(user)
        return Response({
            "access": str(refresh.access_token), "refresh": str(refresh),
            "role": role, "is_superuser": user.is_superuser, "is_staff": user.is_staff,
            "username": user.username, "full_name": user.get_full_name(), "user_id": user.id,
        })


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


# =============================================================================
# USER MANAGEMENT
# =============================================================================

class UserCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({"error": "Admin privileges required"}, status=status.HTTP_403_FORBIDDEN)
        username   = request.data.get("username")
        password   = request.data.get("password")
        first_name = request.data.get("first_name", "")
        last_name  = request.data.get("last_name", "")
        email      = request.data.get("email", "")
        role       = request.data.get("role", "patient")
        mobile     = request.data.get("mobile", "")
        dob        = request.data.get("date_of_birth")
        sex        = request.data.get("sex", "")
        clinic_id  = request.data.get("clinic")
        department = request.data.get("department", "")
        if not username or not password:
            return Response({"error": "username and password are required"}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already taken"}, status=status.HTTP_400_BAD_REQUEST)
        valid_roles = [r[0] for r in User.ROLE_CHOICES]
        if role not in valid_roles:
            return Response({"error": f"Invalid role. Must be one of: {valid_roles}"}, status=status.HTTP_400_BAD_REQUEST)
        clinic = Clinic.objects.filter(id=clinic_id).first() if clinic_id else None
        user = User.objects.create_user(
            username=username, password=password, first_name=first_name, last_name=last_name,
            email=email, role=role, mobile=mobile, date_of_birth=dob or None,
            sex=sex, clinic=clinic, department=department,
        )
        return Response({"id": user.id, "username": user.username, "full_name": user.get_full_name(), "role": role},
                        status=status.HTTP_201_CREATED)


class PatientListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        qs = User.objects.filter(role="patient")
        if clinic_id:
            qs = qs.filter(clinic_id=clinic_id)
        return Response([{"id": p.id, "full_name": p.get_full_name() or p.username,
                          "username": p.username, "email": p.email, "mobile": p.mobile or ""} for p in qs])


class SalesListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        qs = User.objects.filter(role="sales")
        if clinic_id:
            qs = qs.filter(clinic_id=clinic_id)
        return Response([{"id": s.id, "full_name": s.get_full_name() or s.username,
                          "username": s.username, "email": s.email,
                          "clinic": (s.clinic.name if s.clinic else "")} for s in qs])


# =============================================================================
# CLINICS
# =============================================================================

class ClinicListCreateView(APIView):
    def get_permissions(self):
        return [AllowAny()] if self.request.method == "GET" else [IsAuthenticated()]

    def get(self, request):
        return Response([{"id": c.id, "name": c.name, "clinic_id": c.clinic_id}
                         for c in Clinic.objects.all()])

    def post(self, request):
        if not request.user.is_staff:
            return Response({"error": "Admin privileges required"}, status=status.HTTP_403_FORBIDDEN)
        name = request.data.get("name"); clinic_id = request.data.get("clinic_id")
        if not name or not clinic_id:
            return Response({"error": "name and clinic_id are required"}, status=status.HTTP_400_BAD_REQUEST)
        if Clinic.objects.filter(clinic_id=clinic_id).exists():
            return Response({"error": "clinic_id already exists"}, status=status.HTTP_400_BAD_REQUEST)
        clinic = Clinic.objects.create(name=name, clinic_id=clinic_id)
        return Response({"id": clinic.id, "name": clinic.name, "clinic_id": clinic.clinic_id},
                        status=status.HTTP_201_CREATED)


# =============================================================================
# DOCTORS
# =============================================================================

class DoctorListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        doctors = User.objects.filter(role="doctor").select_related("clinic")
        if clinic_id:
            doctors = doctors.filter(clinic_id=clinic_id)
        return Response([{"id": d.id, "full_name": d.get_full_name() or d.username,
                          "username": d.username, "department": d.department or "",
                          "clinic": (d.clinic.name if d.clinic else "")} for d in doctors])


# =============================================================================
# AVAILABILITY
# =============================================================================

class DoctorAvailabilityView(APIView):
    def get_permissions(self):
        return [AllowAny()] if self.request.method == "GET" else [IsAuthenticated()]

    def get(self, request, doctor_id):
        return Response(DoctorAvailabilitySerializer(
            DoctorAvailability.objects.filter(doctor_id=doctor_id, clinic__isnull=False), many=True).data)

    def post(self, request):
        if request.user.role != "doctor":
            return Response({"error": "Doctors only"}, status=status.HTTP_403_FORBIDDEN)
        clinic_id_or_name = request.data.get("clinic")
        day = request.data.get("day_of_week"); start_time = request.data.get("start_time"); end_time = request.data.get("end_time")
        if not clinic_id_or_name or day is None or not start_time or not end_time:
            return Response({"error": "clinic, day_of_week, start_time, and end_time are required"}, status=status.HTTP_400_BAD_REQUEST)
        clinic = None
        try:
            clinic = Clinic.objects.get(id=clinic_id_or_name)
        except (Clinic.DoesNotExist, ValueError, TypeError):
            try:
                clinic = Clinic.objects.get(name=clinic_id_or_name)
            except Clinic.DoesNotExist:
                clinic = Clinic.objects.filter(clinic_id=clinic_id_or_name).first()
        if not clinic:
            return Response({"error": "Clinic not found"}, status=status.HTTP_404_NOT_FOUND)
        import time as _time
        from django.db import transaction as _tx, OperationalError as _OpErr
        for _ in range(4):
            try:
                with _tx.atomic():
                    existing = DoctorAvailability.objects.filter(
                        doctor=request.user, clinic=clinic, day_of_week=int(day)).first()
                    if existing:
                        existing.start_time = start_time; existing.end_time = end_time
                        existing.save(update_fields=["start_time", "end_time"])
                        avail = existing; created = False
                    else:
                        avail = DoctorAvailability.objects.create(
                            doctor=request.user, clinic=clinic, day_of_week=int(day),
                            start_time=start_time, end_time=end_time)
                        created = True
                break
            except _OpErr:
                _time.sleep(0.25)
        else:
            return Response({"error": "Database busy — please try again."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(DoctorAvailabilitySerializer(avail).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class DoctorAvailabilityCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, doctor_id):
        now_local = timezone.localtime(timezone.now())
        available = self._is_doctor_available_now(doctor_id)
        rows = list(DoctorAvailability.objects.filter(
            doctor_id=doctor_id, clinic__isnull=False
        ).values("day_of_week", "start_time", "end_time", "clinic__name"))
        return Response({"available": available, "doctor_id": doctor_id,
                         "debug": {"server_local_time": now_local.strftime("%H:%M:%S"),
                                   "server_local_day": now_local.strftime("%A"),
                                   "server_weekday_int": now_local.weekday(),
                                   "server_timezone": str(timezone.get_current_timezone()),
                                   "availability_rows": rows}})

    @staticmethod
    def _is_doctor_available_now(doctor_id):
        now_local = timezone.localtime(timezone.now())
        if DoctorAvailability.objects.filter(
            doctor_id=doctor_id, clinic__isnull=False,
            day_of_week=now_local.weekday(),
            start_time__lte=now_local.time(), end_time__gte=now_local.time(),
        ).exists():
            return True
        return Meeting.objects.filter(
            doctor_id=doctor_id, status__in=["scheduled", "started"],
            scheduled_time__lte=now_local + timedelta(minutes=15),
            scheduled_time__gte=now_local - timedelta(minutes=60),
        ).exists()


class DoctorAvailableSlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, doctor_id):
        date_str = request.query_params.get("date"); clinic_id = request.query_params.get("clinic")
        if not date_str:
            return Response({"error": "date parameter required (YYYY-MM-DD)"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({"error": "Invalid date format."}, status=status.HTTP_400_BAD_REQUEST)
        avail_qs = DoctorAvailability.objects.filter(
            doctor_id=doctor_id, clinic__isnull=False, day_of_week=date_obj.weekday())
        if clinic_id:
            avail_qs = avail_qs.filter(clinic_id=clinic_id)
        seen = set(); slots = []
        for avail in avail_qs:
            current = datetime.combine(date_obj, avail.start_time)
            end = datetime.combine(date_obj, avail.end_time)
            while current < end:
                s = current.strftime("%H:%M")
                if s not in seen:
                    seen.add(s); slots.append(s)
                current += timedelta(minutes=15)
        return Response({"slots": slots, "date": date_str, "doctor_id": doctor_id})


# =============================================================================
# SALES AVAILABILITY
# =============================================================================

class SalesAvailabilityView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, sales_id):
        return Response(DoctorAvailabilitySerializer(
            DoctorAvailability.objects.filter(doctor_id=sales_id, clinic__isnull=True), many=True).data)

    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if request.user.role != "sales":
            return Response({"error": "Sales representatives only"}, status=status.HTTP_403_FORBIDDEN)
        day = request.data.get("day_of_week"); start_time = request.data.get("start_time"); end_time = request.data.get("end_time")
        if day is None or not start_time or not end_time:
            return Response({"error": "day_of_week, start_time, end_time are required"}, status=status.HTTP_400_BAD_REQUEST)
        day = int(day)
        existing = DoctorAvailability.objects.filter(doctor=request.user, clinic__isnull=True, day_of_week=day).first()
        if existing:
            existing.start_time = start_time; existing.end_time = end_time; existing.save()
            return Response(DoctorAvailabilitySerializer(existing).data, status=status.HTTP_200_OK)
        avail = DoctorAvailability.objects.create(
            doctor=request.user, clinic=None, day_of_week=day, start_time=start_time, end_time=end_time)
        return Response(DoctorAvailabilitySerializer(avail).data, status=status.HTTP_201_CREATED)


class SalesAvailableSlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, sales_id):
        date_str = request.query_params.get("date")
        if not date_str:
            return Response({"error": "date parameter required (YYYY-MM-DD)"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({"error": "Invalid date format."}, status=status.HTTP_400_BAD_REQUEST)
        avail_qs = DoctorAvailability.objects.filter(
            doctor_id=sales_id, clinic__isnull=True, day_of_week=date_obj.weekday())
        seen = set(); slots = []
        for avail in avail_qs:
            current = datetime.combine(date_obj, avail.start_time)
            end = datetime.combine(date_obj, avail.end_time)
            while current < end:
                s = current.strftime("%H:%M")
                if s not in seen:
                    seen.add(s); slots.append(s)
                current += timedelta(minutes=15)
        return Response({"slots": slots, "date": date_str, "sales_id": sales_id})


# =============================================================================
# DOUBLE-BOOKING GUARD
# =============================================================================

def _check_double_booking(target_user, sched_time, field="doctor"):
    qs = Meeting.objects.filter(scheduled_time=sched_time, status__in=["scheduled", "started"])
    return (qs.filter(doctor=target_user) if field == "doctor" else qs.filter(sales=target_user)).exists()


# =============================================================================
# MEETING BOOKING
# =============================================================================

class MeetingBookView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            appt_type    = request.data.get("appointment_type", "consultation")
            is_sales_mtg = (appt_type == "sales_meeting")

            clinic_name_or_id = request.data.get("clinic")
            clinic_id = None
            if clinic_name_or_id:
                try:
                    clinic_id = Clinic.objects.get(name=clinic_name_or_id).id
                except Clinic.DoesNotExist:
                    try:
                        clinic_id = Clinic.objects.get(id=clinic_name_or_id).id
                    except Clinic.DoesNotExist:
                        clinic_id = None

            doctor_data = request.data.get("doctor"); doctor_id = None
            if doctor_data:
                if isinstance(doctor_data, dict):
                    uname = doctor_data.get("username")
                    if uname:
                        doc_obj = User.objects.filter(username=uname).first()
                        if doc_obj: doctor_id = doc_obj.id
                    if not doctor_id and doctor_data.get("id"):
                        doctor_id = int(doctor_data["id"])
                elif isinstance(doctor_data, int):
                    doctor_id = doctor_data

            sales_id     = request.data.get("sales_id")
            reason       = (request.data.get("appointment_reason") or request.data.get("appointment", {}).get("reason", ""))
            sched_time   = (request.data.get("scheduled_time")
                            or request.data.get("appointment", {}).get("start_datetime")
                            or request.data.get("appointment", {}).get("schedule_time"))
            duration     = int(request.data.get("duration") or request.data.get("appointment", {}).get("duration", 30) or 30)
            department   = request.data.get("department", "")
            remark       = (request.data.get("remark") or request.data.get("appointment", {}).get("remark", "") or "")
            meeting_type = request.data.get("meeting_type", "SALES_MEETING" if is_sales_mtg else "CONSULT")

            if not sched_time:
                return Response({"error": "scheduled_time is required"}, status=status.HTTP_400_BAD_REQUEST)

            caller_role = request.user.role
            try:
                sched_dt = datetime.fromisoformat(sched_time)
                if timezone.is_naive(sched_dt):
                    sched_dt = timezone.make_aware(sched_dt, timezone.get_current_timezone())
            except (ValueError, TypeError):
                return Response({"error": f"Invalid date/time format: {sched_time}"}, status=status.HTTP_400_BAD_REQUEST)

            day_of_week = sched_dt.weekday(); slot_time = sched_dt.time()
            patient = None; sales_user = None

            if caller_role == "sales":
                sales_user   = request.user
                patient_data = request.data.get("patient")
                patient = create_patient(patient_data) if isinstance(patient_data, dict) \
                    else get_object_or_404(User, id=patient_data) if patient_data else None
                if not patient:
                    return Response({"error": "Patient is required for sales booking"}, status=status.HTTP_400_BAD_REQUEST)
            elif caller_role == "doctor":
                patient_data = request.data.get("patient")
                patient = create_patient(patient_data) if isinstance(patient_data, dict) \
                    else get_object_or_404(User, id=patient_data) if patient_data else None
                if not patient:
                    return Response({"error": "Patient is required for doctor booking"}, status=status.HTTP_400_BAD_REQUEST)
                if not doctor_id: doctor_id = request.user.id
            else:
                patient = request.user
                if sales_id:
                    try:
                        sales_user = User.objects.get(id=sales_id, role="sales")
                    except User.DoesNotExist:
                        pass

            if is_sales_mtg:
                if not sales_user:
                    return Response({"error": "A sales representative is required."}, status=status.HTTP_400_BAD_REQUEST)
                any_avail = DoctorAvailability.objects.filter(doctor=sales_user, clinic__isnull=True).exists()
                if any_avail and caller_role != "doctor":
                    if not DoctorAvailability.objects.filter(
                        doctor=sales_user, clinic__isnull=True, day_of_week=day_of_week,
                        start_time__lte=slot_time, end_time__gte=slot_time).exists():
                        return Response({"error": f"{sales_user.get_full_name()} is not available at that time."},
                                        status=status.HTTP_400_BAD_REQUEST)
                if _check_double_booking(sales_user, sched_dt, field="sales"):
                    return Response({"error": f"{sales_user.get_full_name()} already has a meeting at this time."},
                                    status=status.HTTP_400_BAD_REQUEST)
                participants = [
                    {"name": patient.get_full_name() or patient.username, "email": patient.email, "role": "patient"},
                    {"name": sales_user.get_full_name() or sales_user.username, "email": sales_user.email, "role": "sales"},
                ]
                meeting = Meeting.objects.create(
                    meeting_type=meeting_type, appointment_type=appt_type, scheduled_time=sched_dt,
                    duration=duration, participants=participants, patient=patient, doctor=None,
                    sales=sales_user, clinic=None, appointment_reason=reason, department=department,
                    remark=remark, status="scheduled")
                return Response({"meeting_id": meeting.meeting_id, "room_id": meeting.room_id,
                                 "scheduled_time": meeting.scheduled_time.isoformat(), "status": meeting.status},
                                status=status.HTTP_201_CREATED)

            if not clinic_id or not doctor_id:
                return Response({"error": "clinic and doctor are required for consultations"}, status=status.HTTP_400_BAD_REQUEST)
            clinic = get_object_or_404(Clinic, id=clinic_id)
            doctor = get_object_or_404(User, id=doctor_id)
            if caller_role == "sales": appt_type = "consultation"

            any_avail = DoctorAvailability.objects.filter(doctor=doctor, clinic=clinic).exists()
            if any_avail and caller_role != "doctor":
                if not DoctorAvailability.objects.filter(
                    doctor=doctor, clinic=clinic, day_of_week=day_of_week,
                    start_time__lte=slot_time, end_time__gte=slot_time).exists():
                    return Response({"error": f"Dr. {doctor.get_full_name()} is not available at that time."},
                                    status=status.HTTP_400_BAD_REQUEST)
            if _check_double_booking(doctor, sched_dt, field="doctor"):
                return Response({"error": f"Dr. {doctor.get_full_name()} already has an appointment at this time."},
                                status=status.HTTP_400_BAD_REQUEST)

            participants = [
                {"name": doctor.get_full_name() or doctor.username, "email": doctor.email, "role": "doctor"},
                {"name": patient.get_full_name() or patient.username, "email": patient.email, "role": "patient"},
            ]
            if sales_user:
                participants.append({"name": sales_user.get_full_name() or sales_user.username,
                                     "email": sales_user.email, "role": "sales"})
            meeting = Meeting.objects.create(
                meeting_type=meeting_type, appointment_type=appt_type, scheduled_time=sched_dt,
                duration=duration, participants=participants, patient=patient, doctor=doctor,
                sales=sales_user, clinic=clinic, appointment_reason=reason, department=department,
                remark=remark, status="scheduled")
            return Response({"meeting_id": meeting.meeting_id, "room_id": meeting.room_id,
                             "scheduled_time": meeting.scheduled_time.isoformat(), "status": meeting.status},
                            status=status.HTTP_201_CREATED)

        except Exception as e:
            print(traceback.format_exc())
            return Response({"error": f"Failed to book appointment: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# =============================================================================
# APPOINTMENT LIST VIEWS
# =============================================================================

class DoctorAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Upcoming (non-ended) meetings for the doctor's calendar."""
        clinic_id = request.query_params.get("clinic")
        _expire_stale_meetings()
        meetings = (
            Meeting.objects
            .filter(doctor=request.user)
            .exclude(status="ended")
            .select_related("patient", "doctor", "sales", "clinic")
        )
        if clinic_id:
            meetings = meetings.filter(clinic_id=clinic_id)
        return Response(MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data)


class DoctorPastMeetingsView(APIView):
    """Returns completed (ended) meetings for the logged-in doctor."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _expire_stale_meetings()
        clinic_id = request.query_params.get("clinic")
        meetings = (
            Meeting.objects
            .filter(doctor=request.user, status="ended")
            .select_related("patient", "doctor", "sales", "clinic")
        )
        if clinic_id:
            meetings = meetings.filter(clinic_id=clinic_id)
        return Response(MeetingSerializer(meetings.order_by("-scheduled_time"), many=True).data)


class PatientAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _expire_stale_meetings()
        meetings = (
            Meeting.objects
            .filter(patient=request.user)
            .select_related("patient", "doctor", "sales", "clinic")
        )
        return Response(MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data)


class SalesAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _expire_stale_meetings()
        meetings = (
            Meeting.objects
            .filter(sales=request.user)
            .select_related("patient", "doctor", "sales", "clinic")
        )
        return Response(MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data)


class MeetingListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = request.query_params.get("role"); clinic_id = request.query_params.get("clinic")
        _expire_stale_meetings()
        if role == "doctor":
            meetings = Meeting.objects.filter(doctor=request.user).exclude(status="ended")
        elif role == "sales":
            meetings = Meeting.objects.filter(sales=request.user)
        else:
            meetings = Meeting.objects.filter(patient=request.user)
        meetings = meetings.select_related("patient", "doctor", "sales", "clinic")
        if clinic_id:
            meetings = meetings.filter(clinic_id=clinic_id)
        return Response(MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data)

# ─── REPLACE your existing MeetingDetailView with this ───────────────────────
class MeetingDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, meeting_id):
        meeting = _get_meeting_by_key(meeting_id, select_related=("doctor", "patient", "clinic"))
        if not meeting:
            return Response({"error": "Meeting not found"}, status=status.HTTP_404_NOT_FOUND)

        patient = meeting.patient
        doctor  = meeting.doctor

        data = {
            "meeting_id":         str(meeting.meeting_id),
            "room_id":            str(meeting.room_id),
            "status":             meeting.status,
            "scheduled_time":     meeting.scheduled_time.isoformat() if meeting.scheduled_time else None,
            "duration":           meeting.duration,
            "appointment_reason": meeting.appointment_reason or "",
            "department":         meeting.department or "",
            "remark":             meeting.remark or "",
            "clinic":             meeting.clinic.name if meeting.clinic else "",

            # Doctor
            "doctor_name":     doctor.get_full_name() if doctor else "",
            "doctor_username": doctor.username        if doctor else "",

            # Patient — field names match exactly what InfoSideBar.jsx expects
            "patient": {
                "first_name":    patient.first_name          if patient and patient.first_name    else "",
                "last_name":     patient.last_name           if patient and patient.last_name     else "",
                "sex":           patient.sex                 if patient and patient.sex           else "",
                "mobile":        patient.mobile              if patient and patient.mobile        else "",
                "date_of_birth": str(patient.date_of_birth)  if patient and patient.date_of_birth else "",
                "email":         patient.email               if patient and patient.email         else "",
                "username":      patient.username            if patient                           else "",
            } if patient else None,
        }

        return Response(data)
# =============================================================================
# MEETING START / DIRECT ENTRY
# =============================================================================

class MeetingStartView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            if not meeting_id:
                return Response({"error": "meeting_id is required"}, status=status.HTTP_400_BAD_REQUEST)
            meeting = _get_meeting_or_404(meeting_id)
            if meeting.status == "ended":
                return Response({"error": "This appointment has already ended"}, status=status.HTTP_400_BAD_REQUEST)
            caller_role = "participant"
            if request.user.is_superuser: caller_role = "admin"
            elif hasattr(request.user, "profile"): caller_role = request.user.profile.role
            if meeting.status != "started":
                is_sales_meeting = (meeting.appointment_type == "sales_meeting" or meeting.doctor_id is None)
                if caller_role == "doctor" and not is_sales_meeting:
                    if meeting.doctor and not DoctorAvailabilityCheckView._is_doctor_available_now(meeting.doctor_id):
                        now_local = timezone.localtime(timezone.now())
                        rows = list(DoctorAvailability.objects.filter(
                            doctor_id=meeting.doctor_id, clinic__isnull=False,
                        ).values("day_of_week", "start_time", "end_time"))
                        return Response({"error": (f"You are not available right now. "
                                                   f"Local time: {now_local.strftime('%A %H:%M')}. "
                                                   f"Your hours: {rows}."),
                                         "doctor_available": False}, status=status.HTTP_400_BAD_REQUEST)
                meeting.status = "started"; meeting.save()
            room_url = f"http://{API}/room/{meeting.room_id}?meeting_id={meeting.meeting_id}"
            return Response({"room_id": meeting.room_id, "meeting_id": meeting.meeting_id,
                             "room_url": room_url, "doctor_available": True})
        except Exception:
            print(traceback.format_exc())
            return Response({"error": "Failed to start meeting"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DirectRoomEntryView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id"); room_id = request.data.get("room_id")
            if not meeting_id or not room_id:
                return Response({"error": "meeting_id and room_id are required"}, status=status.HTTP_400_BAD_REQUEST)
            meeting = _get_meeting_or_404(meeting_id)
            if meeting.room_id != room_id:
                return Response({"error": "Meeting not found."}, status=status.HTTP_404_NOT_FOUND)
            if meeting.status == "ended":
                return Response({"error": "This appointment has already ended."}, status=status.HTTP_400_BAD_REQUEST)
            now = timezone.now()
            if now < _meeting_active_start(meeting):
                opens_at = timezone.localtime(_meeting_active_start(meeting)).strftime("%H:%M")
                return Response({"error": f"Meeting not active yet. Link opens at {opens_at} (5 min before scheduled time)."},
                                status=status.HTTP_400_BAD_REQUEST)
            if now > _meeting_expiry(meeting):
                meeting.status = "ended"; meeting.save(update_fields=["status"])
                return Response({"error": "This meeting link has expired."}, status=status.HTTP_400_BAD_REQUEST)
            if meeting.status == "scheduled":
                meeting.status = "started"; meeting.save(update_fields=["status"])
            expiry_iso = timezone.localtime(_meeting_expiry(meeting)).isoformat()
            return Response({"status": "success", "meeting_id": meeting.meeting_id,
                             "room_id": meeting.room_id, "expires_at": expiry_iso}, status=status.HTTP_200_OK)
        except Exception as e:
            print(traceback.format_exc())
            return Response({"error": f"Failed to enter room: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# =============================================================================
# MEETING END / TRANSCRIPT
# =============================================================================

class MeetingEndView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            meeting_id     = request.data.get("meeting_id")
            speech_to_text = (request.data.get("speech_to_text") or "").strip()
            meeting = _get_meeting_or_404(meeting_id)
            if speech_to_text:
                meeting.speech_to_text = _append_transcript_line(meeting.speech_to_text, speech_to_text)
            if timezone.now() > _meeting_expiry(meeting):
                meeting.status = "ended"
            meeting.save()
            return Response({"status": meeting.status, "meeting_id": meeting.meeting_id,
                             "has_transcript": bool(meeting.speech_to_text)})
        except Exception:
            print(traceback.format_exc())
            return Response({"error": "Failed to end meeting"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MeetingTranscriptAppendView(APIView):
    """Real-time per-line transcript save with dedup."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            line       = (request.data.get("line") or "").strip()
            if not meeting_id or not line:
                return Response({"error": "meeting_id and line are required"}, status=status.HTTP_400_BAD_REQUEST)
            meeting = _get_meeting_or_404(meeting_id)
            meeting.speech_to_text = _append_transcript_line(meeting.speech_to_text, line)
            meeting.save()
            return Response({"status": "appended"})
        except Exception:
            print(traceback.format_exc())
            return Response({"error": "Failed to append transcript"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# =============================================================================
# Task 2 — MEETING HISTORY (chat + transcript restore on rejoin)
#
# Requires Meeting model to have:
#   chat_log = models.JSONField(default=list, blank=True)
#
# Add to urls.py:
#   path("api/meeting/<str:meeting_id>/history/", MeetingHistoryView.as_view()),
#   path("api/meeting/chat/",                     MeetingChatAppendView.as_view()),
# =============================================================================

class MeetingHistoryView(APIView):
    """
    GET /api/meeting/<meeting_id>/history/

    Returns persisted chat log and transcript for a meeting.
    Called by MeetingRoom.js on (re)connect to restore conversation state.
    """
    permission_classes = [AllowAny]

    def get(self, request, meeting_id):
        try:
            meeting = _get_meeting_by_key(meeting_id)
            if not meeting:
                return Response({"error": "Meeting not found"}, status=status.HTTP_404_NOT_FOUND)

            # chat_log is a JSONField — list of {text, sender, timestamp} dicts
            chat_log = []
            if hasattr(meeting, "chat_log") and isinstance(meeting.chat_log, list):
                chat_log = meeting.chat_log

            return Response({
                "meeting_id": str(meeting.meeting_id),
                "transcript": meeting.speech_to_text or "",
                "chat_log":   chat_log,
            })
        except Exception:
            print(traceback.format_exc())
            return Response({"error": "Failed to load history"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MeetingChatAppendView(APIView):
    """
    POST /api/meeting/chat/

    Body: { meeting_id, message: {text, sender, timestamp} }

    Persists a single chat message to the meeting's chat_log JSONField
    so it can be restored when a participant rejoins.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            message    = request.data.get("message")   # {text, sender, timestamp}

            if not meeting_id:
                return Response({"error": "meeting_id is required"}, status=status.HTTP_400_BAD_REQUEST)
            if not message or not isinstance(message, dict):
                return Response({"error": "message must be an object with text/sender/timestamp"}, status=status.HTTP_400_BAD_REQUEST)

            meeting = _get_meeting_or_404(meeting_id)

            # Ensure chat_log is initialised
            if not hasattr(meeting, "chat_log") or not isinstance(meeting.chat_log, list):
                meeting.chat_log = []

            # Sanitise the incoming message to store only safe fields
            safe_msg = {
                "text":      str(message.get("text", ""))[:2000],
                "sender":    str(message.get("sender", "Unknown"))[:120],
                "timestamp": str(message.get("timestamp", ""))[:20],
            }
            meeting.chat_log.append(safe_msg)
            meeting.save(update_fields=["chat_log"])

            return Response({"status": "saved", "count": len(meeting.chat_log)})
        except Exception:
            print(traceback.format_exc())
            return Response({"error": "Failed to save chat message"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class patient_details(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        patients = User.objects.filter(role="patient")
        return Response([{"id": p.id, "name": p.get_full_name() or p.username} for p in patients])