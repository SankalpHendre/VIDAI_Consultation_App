import traceback
from datetime import datetime, timedelta

from django.contrib.auth import authenticate
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
# AUTH
# =============================================================================

class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        user = authenticate(username=username, password=password)
        if user is None:
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        role = user.role
        if user.is_superuser:
            role = "admin"

        refresh = RefreshToken.for_user(user)
        return Response({
            "access":       str(refresh.access_token),
            "refresh":      str(refresh),
            "role":         role,
            "is_superuser": user.is_superuser,
            "is_staff":     user.is_staff,
            "username":     user.username,
            "full_name":    user.get_full_name(),
            "user_id":      user.id,
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
            return Response(
                {"error": "Admin privileges required"},
                status=status.HTTP_403_FORBIDDEN,
            )

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
            return Response(
                {"error": "username and password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(username=username).exists():
            return Response(
                {"error": "Username already taken"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_roles = [r[0] for r in User.ROLE_CHOICES]
        if role not in valid_roles:
            return Response(
                {"error": f"Invalid role. Must be one of: {valid_roles}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        clinic = Clinic.objects.filter(id=clinic_id).first() if clinic_id else None
        user = User.objects.create_user(
            username=username, password=password,
            first_name=first_name, last_name=last_name, email=email,
            role=role, mobile=mobile, date_of_birth=dob or None,
            sex=sex, clinic=clinic, department=department
        )
        return Response(
            {"id": user.id, "username": user.username,
             "full_name": user.get_full_name(), "role": role},
            status=status.HTTP_201_CREATED,
        )


class PatientListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        qs = User.objects.filter(role="patient")
        if clinic_id:
            qs = qs.filter(clinic_id=clinic_id)
        return Response([{
            "id":        p.id,
            "full_name": p.get_full_name() or p.username,
            "username":  p.username,
            "email":     p.email,
            "mobile":    p.mobile or "",
        } for p in qs])


class SalesListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        qs = User.objects.filter(role="sales")
        if clinic_id:
            qs = qs.filter(clinic_id=clinic_id)
        result = []
        for s in qs:
            result.append({
                "id":        s.id,
                "full_name": s.get_full_name() or s.username,
                "username":  s.username,
                "email":     s.email,
                "clinic":    (s.clinic.name if s.clinic else ""),
            })
        return Response(result)


# =============================================================================
# CLINICS
# =============================================================================

class ClinicListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request):
        clinics = Clinic.objects.all()
        return Response([
            {"id": c.id, "name": c.name, "clinic_id": c.clinic_id}
            for c in clinics
        ])

    def post(self, request):
        if not request.user.is_staff:
            return Response(
                {"error": "Admin privileges required"},
                status=status.HTTP_403_FORBIDDEN,
            )
        name      = request.data.get("name")
        clinic_id = request.data.get("clinic_id")
        if not name or not clinic_id:
            return Response(
                {"error": "name and clinic_id are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Clinic.objects.filter(clinic_id=clinic_id).exists():
            return Response(
                {"error": "clinic_id already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        clinic = Clinic.objects.create(name=name, clinic_id=clinic_id)
        return Response(
            {"id": clinic.id, "name": clinic.name, "clinic_id": clinic.clinic_id},
            status=status.HTTP_201_CREATED,
        )


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
        return Response([{
            "id":         d.id,
            "full_name":  d.get_full_name() or d.username,
            "username":   d.username,
            "department": d.department or "",
            "clinic":     (d.clinic.name if d.clinic else ""),
        } for d in doctors])


# =============================================================================
# AVAILABILITY
# =============================================================================

class DoctorAvailabilityView(APIView):

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request, doctor_id):
        availability = DoctorAvailability.objects.filter(
            doctor_id=doctor_id, clinic__isnull=False
        )
        return Response(DoctorAvailabilitySerializer(availability, many=True).data)

    def post(self, request):
        if request.user.role != "doctor":
            return Response(
                {"error": "Doctors only"},
                status=status.HTTP_403_FORBIDDEN,
            )

        clinic_id_or_name = request.data.get("clinic")
        day               = request.data.get("day_of_week")
        start_time        = request.data.get("start_time")
        end_time          = request.data.get("end_time")

        if not clinic_id_or_name or day is None or not start_time or not end_time:
            return Response(
                {"error": "clinic, day_of_week, start_time, and end_time are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Robust clinic lookup
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

        last_exc = None
        for attempt in range(4):
            try:
                with _tx.atomic():
                    existing = DoctorAvailability.objects.filter(
                        doctor=request.user,
                        clinic=clinic,
                        day_of_week=int(day),
                    ).first()
                    if existing:
                        existing.start_time = start_time
                        existing.end_time   = end_time
                        existing.save(update_fields=["start_time", "end_time"])
                        avail   = existing
                        created = False
                    else:
                        avail = DoctorAvailability.objects.create(
                            doctor=request.user, clinic=clinic,
                            day_of_week=int(day),
                            start_time=start_time, end_time=end_time,
                        )
                        created = True
                break
            except _OpErr as e:
                last_exc = e
                _time.sleep(0.25)
        else:
            return Response(
                {"error": "Database busy — please try again."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            DoctorAvailabilitySerializer(avail).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class DoctorAvailabilityCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, doctor_id):
        now_local = timezone.localtime(timezone.now())
        available = self._is_doctor_available_now(doctor_id)
        rows = list(
            DoctorAvailability.objects.filter(
                doctor_id=doctor_id, clinic__isnull=False
            ).values("day_of_week", "start_time", "end_time", "clinic__name")
        )
        return Response({
            "available":  available,
            "doctor_id":  doctor_id,
            "debug": {
                "server_local_time": now_local.strftime("%H:%M:%S"),
                "server_local_day":  now_local.strftime("%A"),
                "server_weekday_int": now_local.weekday(),
                "server_timezone":   str(timezone.get_current_timezone()),
                "availability_rows": rows,
            },
        })

    @staticmethod
    def _is_doctor_available_now(doctor_id):
        now_local = timezone.localtime(timezone.now())
        today    = now_local.weekday()
        cur_time = now_local.time()

        is_in_hours = DoctorAvailability.objects.filter(
            doctor_id=doctor_id,
            clinic__isnull=False,
            day_of_week=today,
            start_time__lte=cur_time,
            end_time__gte=cur_time,
        ).exists()
        if is_in_hours:
            return True

        start_buffer = now_local + timedelta(minutes=15)
        end_buffer   = now_local - timedelta(minutes=60)
        has_meeting = Meeting.objects.filter(
            doctor_id=doctor_id,
            status__in=["scheduled", "started"],
            scheduled_time__lte=start_buffer,
            scheduled_time__gte=end_buffer
        ).exists()

        return has_meeting


class DoctorAvailableSlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, doctor_id):
        date_str  = request.query_params.get("date")
        clinic_id = request.query_params.get("clinic")

        if not date_str:
            return Response(
                {"error": "date parameter required (YYYY-MM-DD)"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response(
                {"error": "Invalid date format."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        day_of_week = date_obj.weekday()
        avail_qs = DoctorAvailability.objects.filter(
            doctor_id=doctor_id,
            clinic__isnull=False,
            day_of_week=day_of_week,
        )
        if clinic_id:
            avail_qs = avail_qs.filter(clinic_id=clinic_id)

        seen  = set()
        slots = []
        for avail in avail_qs:
            current = datetime.combine(date_obj, avail.start_time)
            end     = datetime.combine(date_obj, avail.end_time)
            while current < end:
                s = current.strftime("%H:%M")
                if s not in seen:
                    seen.add(s)
                    slots.append(s)
                current += timedelta(minutes=15)

        return Response({"slots": slots, "date": date_str, "doctor_id": doctor_id})


# =============================================================================
# SALES AVAILABILITY
# =============================================================================

class SalesAvailabilityView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, sales_id):
        availability = DoctorAvailability.objects.filter(
            doctor_id=sales_id, clinic__isnull=True
        )
        return Response(DoctorAvailabilitySerializer(availability, many=True).data)

    def post(self, request):
        if not request.user.is_authenticated:
            return Response(
                {"error": "Authentication required"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if request.user.role != "sales":
            return Response(
                {"error": "Sales representatives only"},
                status=status.HTTP_403_FORBIDDEN,
            )

        day        = request.data.get("day_of_week")
        start_time = request.data.get("start_time")
        end_time   = request.data.get("end_time")

        if day is None or not start_time or not end_time:
            return Response(
                {"error": "day_of_week, start_time, end_time are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        day = int(day)
        existing = DoctorAvailability.objects.filter(
            doctor=request.user, clinic__isnull=True, day_of_week=day,
        ).first()

        if existing:
            existing.start_time = start_time
            existing.end_time   = end_time
            existing.save()
            return Response(DoctorAvailabilitySerializer(existing).data, status=status.HTTP_200_OK)

        avail = DoctorAvailability.objects.create(
            doctor=request.user, clinic=None,
            day_of_week=day, start_time=start_time, end_time=end_time,
        )
        return Response(DoctorAvailabilitySerializer(avail).data, status=status.HTTP_201_CREATED)


class SalesAvailableSlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, sales_id):
        date_str = request.query_params.get("date")
        if not date_str:
            return Response(
                {"error": "date parameter required (YYYY-MM-DD)"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response(
                {"error": "Invalid date format."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        day_of_week = date_obj.weekday()
        avail_qs = DoctorAvailability.objects.filter(
            doctor_id=sales_id, clinic__isnull=True, day_of_week=day_of_week,
        )

        seen  = set()
        slots = []
        for avail in avail_qs:
            current = datetime.combine(date_obj, avail.start_time)
            end     = datetime.combine(date_obj, avail.end_time)
            while current < end:
                s = current.strftime("%H:%M")
                if s not in seen:
                    seen.add(s)
                    slots.append(s)
                current += timedelta(minutes=15)

        return Response({"slots": slots, "date": date_str, "sales_id": sales_id})


# =============================================================================
# DOUBLE-BOOKING GUARD
# =============================================================================

def _check_double_booking(target_user, sched_time, field="doctor"):
    qs = Meeting.objects.filter(
        scheduled_time=sched_time,
        status__in=["scheduled", "started"],
    )
    if field == "doctor":
        qs = qs.filter(doctor=target_user)
    else:
        qs = qs.filter(sales=target_user)
    return qs.exists()


# =============================================================================
# MEETING BOOKING
# =============================================================================

class MeetingBookView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            appt_type    = request.data.get("appointment_type", "consultation")
            is_sales_mtg = (appt_type == "sales_meeting")

            # -- Clinic lookup ----------------------------------------------
            clinic_name_or_id = request.data.get("clinic")
            clinic_id = None
            if clinic_name_or_id:
                try:
                    clinic = Clinic.objects.get(name=clinic_name_or_id)
                    clinic_id = clinic.id
                except Clinic.DoesNotExist:
                    try:
                        clinic = Clinic.objects.get(id=clinic_name_or_id)
                        clinic_id = clinic.id
                    except Clinic.DoesNotExist:
                        clinic_id = None

            # -- Doctor lookup (frontend sends { username, id }) ------------
            doctor_data = request.data.get("doctor")
            doctor_id   = None
            if doctor_data:
                if isinstance(doctor_data, dict):
                    uname = doctor_data.get("username")
                    if uname:
                        doc_obj = User.objects.filter(username=uname).first()
                        if doc_obj:
                            doctor_id = doc_obj.id
                    if not doctor_id and doctor_data.get("id"):
                        doctor_id = int(doctor_data["id"])
                elif isinstance(doctor_data, int):
                    doctor_id = doctor_data

            # -- Other fields ----------------------------------------------
            sales_id = request.data.get("sales_id")

            reason     = (
                request.data.get("appointment_reason")
                or request.data.get("appointment", {}).get("reason", "")
            )
            sched_time = (
                request.data.get("scheduled_time")
                or request.data.get("appointment", {}).get("start_datetime")
                or request.data.get("appointment", {}).get("schedule_time")
            )
            duration   = int(
                request.data.get("duration")
                or request.data.get("appointment", {}).get("duration", 30)
                or 30
            )
            department = request.data.get("department", "")
            remark     = (
                request.data.get("remark")
                or request.data.get("appointment", {}).get("remark", "")
                or ""
            )
            meeting_type = request.data.get(
                "meeting_type",
                "SALES_MEETING" if is_sales_mtg else "CONSULT",
            )

            if not sched_time:
                return Response(
                    {"error": "scheduled_time is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            caller_role = request.user.role

            # -- Timezone-aware datetime ------------------------------------
            try:
                sched_dt = datetime.fromisoformat(sched_time)
                if timezone.is_naive(sched_dt):
                    sched_dt = timezone.make_aware(sched_dt, timezone.get_current_timezone())
            except (ValueError, TypeError):
                return Response(
                    {"error": f"Invalid date/time format: {sched_time}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            day_of_week = sched_dt.weekday()
            slot_time   = sched_dt.time()

            # -- Determine patient & optional sales user --------------------
            patient = None
            sales_user = None

            if caller_role == "sales":
                sales_user   = request.user
                patient_data = request.data.get("patient")
                if isinstance(patient_data, dict):
                    patient = create_patient(patient_data)
                elif patient_data:
                    patient = get_object_or_404(User, id=patient_data)

                if not patient:
                    return Response(
                        {"error": "Patient is required for sales booking"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            elif caller_role == "doctor":
                patient_data = request.data.get("patient")
                if isinstance(patient_data, dict):
                    patient = create_patient(patient_data)
                elif patient_data:
                    patient = get_object_or_404(User, id=patient_data)

                if not patient:
                    return Response(
                        {"error": "Patient is required for doctor booking"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if not doctor_id:
                    doctor_id = request.user.id
            else:
                patient = request.user
                if sales_id:
                    try:
                        sales_user = User.objects.get(id=sales_id, role="sales")
                    except User.DoesNotExist:
                        pass

            # -- SALES MEETING ---------------------------------------------
            if is_sales_mtg:
                if not sales_user:
                    return Response(
                        {"error": "A sales representative is required for a sales meeting."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                any_avail = DoctorAvailability.objects.filter(
                    doctor=sales_user, clinic__isnull=True,
                ).exists()
                if any_avail and caller_role != "doctor":
                    slot_ok = DoctorAvailability.objects.filter(
                        doctor=sales_user,
                        clinic__isnull=True,
                        day_of_week=day_of_week,
                        start_time__lte=slot_time,
                        end_time__gte=slot_time,
                    ).exists()
                    if not slot_ok:
                        return Response({
                            "error": (
                                f"{sales_user.get_full_name()} is not available on "
                                f"{sched_dt.strftime('%A')} at {sched_dt.strftime('%H:%M')}."
                            )
                        }, status=status.HTTP_400_BAD_REQUEST)

                if _check_double_booking(sales_user, sched_dt, field="sales"):
                    return Response(
                        {"error": f"{sales_user.get_full_name()} already has a meeting at this time."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                participants = [
                    {"name": patient.get_full_name() or patient.username,
                     "email": patient.email, "role": "patient"},
                    {"name": sales_user.get_full_name() or sales_user.username,
                     "email": sales_user.email, "role": "sales"},
                ]
                meeting = Meeting.objects.create(
                    meeting_type=meeting_type, appointment_type=appt_type,
                    scheduled_time=sched_dt, duration=duration,
                    participants=participants, patient=patient,
                    doctor=None, sales=sales_user, clinic=None,
                    appointment_reason=reason, department=department,
                    remark=remark, status="scheduled",
                )
                return Response({
                    "meeting_id":     meeting.meeting_id,
                    "room_id":        meeting.room_id,
                    "scheduled_time": meeting.scheduled_time.isoformat(),
                    "status":         meeting.status,
                }, status=status.HTTP_201_CREATED)

            # -- CONSULTATION ----------------------------------------------
            if not clinic_id or not doctor_id:
                return Response(
                    {"error": "clinic and doctor are required for consultations"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            clinic = get_object_or_404(Clinic, id=clinic_id)
            doctor = get_object_or_404(User, id=doctor_id)

            if caller_role == "sales":
                appt_type = "consultation"

            day_of_week = sched_dt.weekday()
            slot_time   = sched_dt.time()

            any_avail = DoctorAvailability.objects.filter(
                doctor=doctor, clinic=clinic,
            ).exists()
            if any_avail and caller_role != "doctor":
                slot_ok = DoctorAvailability.objects.filter(
                    doctor=doctor, clinic=clinic,
                    day_of_week=day_of_week,
                    start_time__lte=slot_time,
                    end_time__gte=slot_time,
                ).exists()
                if not slot_ok:
                    return Response({
                        "error": (
                            f"Dr. {doctor.get_full_name()} is not available on "
                            f"{sched_dt.strftime('%A')} at {sched_dt.strftime('%H:%M')}."
                        )
                    }, status=status.HTTP_400_BAD_REQUEST)

            if _check_double_booking(doctor, sched_dt, field="doctor"):
                return Response(
                    {"error": f"Dr. {doctor.get_full_name()} already has an appointment at this time."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            participants = [
                {"name": doctor.get_full_name() or doctor.username,
                 "email": doctor.email, "role": "doctor"},
                {"name": patient.get_full_name() or patient.username,
                 "email": patient.email, "role": "patient"},
            ]
            if sales_user:
                participants.append({
                    "name":  sales_user.get_full_name() or sales_user.username,
                    "email": sales_user.email,
                    "role":  "sales",
                })

            meeting = Meeting.objects.create(
                meeting_type=meeting_type, appointment_type=appt_type,
                scheduled_time=sched_dt, duration=duration,
                participants=participants, patient=patient,
                doctor=doctor, sales=sales_user, clinic=clinic,
                appointment_reason=reason, department=department,
                remark=remark, status="scheduled",
            )
            return Response({
                "meeting_id":     meeting.meeting_id,
                "room_id":        meeting.room_id,
                "scheduled_time": meeting.scheduled_time.isoformat(),
                "status":         meeting.status,
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            print(traceback.format_exc())
            return Response(
                {"error": f"Failed to book appointment: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# =============================================================================
# APPOINTMENT LIST VIEWS
# =============================================================================

class DoctorAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clinic_id = request.query_params.get("clinic")
        meetings  = (
            Meeting.objects
            .filter(doctor=request.user)
            .select_related("patient", "doctor", "sales", "clinic")
        )
        if clinic_id:
            meetings = meetings.filter(clinic_id=clinic_id)
        return Response(
            MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data
        )


class PatientAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        meetings = (
            Meeting.objects
            .filter(patient=request.user)
            .select_related("patient", "doctor", "sales", "clinic")
        )
        return Response(
            MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data
        )


class SalesAppointmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        meetings = (
            Meeting.objects
            .filter(sales=request.user)
            .select_related("patient", "doctor", "sales", "clinic")
        )
        return Response(
            MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data
        )


class MeetingListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        role      = request.query_params.get("role")
        clinic_id = request.query_params.get("clinic")

        if role == "patient":
            meetings = Meeting.objects.filter(patient=request.user).select_related("patient", "doctor", "sales", "clinic")
        elif role == "doctor":
            meetings = Meeting.objects.filter(doctor=request.user).select_related("patient", "doctor", "sales", "clinic")
        elif role == "sales":
            meetings = Meeting.objects.filter(sales=request.user).select_related("patient", "doctor", "sales", "clinic")
        else:
            meetings = Meeting.objects.filter(patient=request.user).select_related("patient", "doctor", "sales", "clinic")

        if clinic_id:
            meetings = meetings.filter(clinic_id=clinic_id)
        return Response(
            MeetingSerializer(meetings.order_by("scheduled_time"), many=True).data
        )


class MeetingDetailView(APIView):
    """
    Returns full meeting details including speech_to_text (transcript).
    Supports both UUID meeting_id field AND numeric pk so the frontend
    can pass either ?meeting_id=<uuid> or ?meeting_id=14 and still get a result.
    """
    permission_classes = [AllowAny]

    def get(self, request, meeting_id):
        # 1. Try UUID meeting_id field first (preferred)
        meeting = Meeting.objects.filter(meeting_id=meeting_id).first()

        # 2. Fall back to numeric primary key
        if not meeting:
            try:
                meeting = Meeting.objects.filter(pk=int(meeting_id)).first()
            except (ValueError, TypeError):
                pass

        if not meeting:
            return Response(
                {"error": "Meeting not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(MeetingSerializer(meeting).data)


# =============================================================================
# MEETING START / DIRECT ENTRY
# =============================================================================

class MeetingStartView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            if not meeting_id:
                return Response(
                    {"error": "meeting_id is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            meeting = get_object_or_404(Meeting, meeting_id=meeting_id)
            if meeting.status == "ended":
                return Response(
                    {"error": "This appointment has already ended"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            caller_role = "participant"
            if request.user.is_superuser:
                caller_role = "admin"
            elif hasattr(request.user, "profile"):
                caller_role = request.user.profile.role

            if meeting.status != "started":
                is_sales_meeting = (
                    meeting.appointment_type == "sales_meeting"
                    or meeting.doctor_id is None
                )

                if caller_role == "doctor" and not is_sales_meeting:
                    if meeting.doctor and not DoctorAvailabilityCheckView._is_doctor_available_now(meeting.doctor_id):
                        now_local = timezone.localtime(timezone.now())
                        rows = list(
                            DoctorAvailability.objects.filter(
                                doctor_id=meeting.doctor_id, clinic__isnull=False,
                            ).values("day_of_week", "start_time", "end_time")
                        )
                        return Response({
                            "error": (
                                f"You are not available right now. "
                                f"Local time: {now_local.strftime('%A %H:%M')}. "
                                f"Your hours: {rows}."
                            ),
                            "doctor_available": False,
                        }, status=status.HTTP_400_BAD_REQUEST)

                meeting.status = "started"
                meeting.save()

            room_url = f"http://{API}/room/{meeting.room_id}?meeting_id={meeting.meeting_id}"
            return Response({
                "room_id":          meeting.room_id,
                "meeting_id":       meeting.meeting_id,
                "room_url":         room_url,
                "doctor_available": True,
            })

        except Exception:
            print(traceback.format_exc())
            return Response(
                {"error": "Failed to start meeting"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class DirectRoomEntryView(APIView):
    """
    No-auth entry point. Accepts meeting_id + room_id, marks meeting as
    started (if scheduled), and returns the room details.
    Used by both DoctorHome and PatientHome instead of MeetingStartView.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            room_id    = request.data.get("room_id")

            if not meeting_id or not room_id:
                return Response(
                    {"error": "meeting_id and room_id are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            meeting = get_object_or_404(Meeting, meeting_id=meeting_id, room_id=room_id)

            if meeting.status == "ended":
                return Response(
                    {"error": "This appointment has already ended"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if meeting.status == "scheduled":
                meeting.status = "started"
                meeting.save()

            return Response({
                "status":     "success",
                "meeting_id": meeting.meeting_id,
                "room_id":    meeting.room_id,
            }, status=status.HTTP_200_OK)

        except Exception as e:
            print(traceback.format_exc())
            return Response(
                {"error": f"Failed to enter room: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# =============================================================================
# MEETING END / TRANSCRIPT
# =============================================================================

class MeetingEndView(APIView):
    """
    Ends the meeting and saves the transcript.

    KEY FIX: Only overwrite speech_to_text if the caller is sending a
    non-empty transcript. This prevents the doctor's browser (which has
    no local speech-to-text) from wiping out the transcript the patient
    already saved when they ended the call on their side.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            meeting_id     = request.data.get("meeting_id")
            speech_to_text = (request.data.get("speech_to_text") or "").strip()

            meeting = get_object_or_404(Meeting, meeting_id=meeting_id)

            # Always mark as ended
            meeting.status = "ended"

            # Only append/set transcript when caller actually sends content.
            # Doctor ends the call with no speech_to_text → existing transcript preserved.
            if speech_to_text:
                meeting.speech_to_text = (
                    f"{meeting.speech_to_text}\n{speech_to_text}"
                    if meeting.speech_to_text
                    else speech_to_text
                )

            meeting.save()
            return Response({
                "status":         "ended",
                "meeting_id":     meeting.meeting_id,
                "has_transcript": bool(meeting.speech_to_text),
            })
        except Exception:
            print(traceback.format_exc())
            return Response(
                {"error": "Failed to end meeting"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class MeetingTranscriptAppendView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            meeting_id = request.data.get("meeting_id")
            line       = (request.data.get("line") or "").strip()
            if not meeting_id or not line:
                return Response(
                    {"error": "meeting_id and line are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            meeting = get_object_or_404(Meeting, meeting_id=meeting_id)
            meeting.speech_to_text = (
                f"{meeting.speech_to_text}\n{line}"
                if meeting.speech_to_text
                else line
            )
            meeting.save()
            return Response({"status": "appended"})
        except Exception:
            print(traceback.format_exc())
            return Response(
                {"error": "Failed to append transcript"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )