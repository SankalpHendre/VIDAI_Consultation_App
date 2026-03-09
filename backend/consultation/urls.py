# consultation/urls.py  — FIXED (wildcard routes are LAST)

from django.urls import path
from .views import (
    MeetingHistoryView,
    MeetingChatAppendView,
    patient_details,
    LoginView,
    ProfileView,
    UserCreateView,
    PatientListView,
    SalesListView,
    ClinicListCreateView,
    DoctorListView,
    DoctorAvailabilityView,
    DoctorAvailabilityCheckView,
    DoctorAvailableSlotsView,
    SalesAvailabilityView,
    SalesAvailableSlotsView,
    MeetingBookView,
    DoctorAppointmentListView,
    DoctorPastMeetingsView,
    PatientAppointmentListView,
    SalesAppointmentListView,
    MeetingListView,
    MeetingDetailView,
    MeetingStartView,
    DirectRoomEntryView,
    MeetingEndView,
    MeetingTranscriptAppendView,
)

urlpatterns = [
    # -- Auth ----------------------------------------------------------------
    path("login/",   LoginView.as_view(),   name="login"),
    path("profile/", ProfileView.as_view(), name="profile"),

    # -- User management -----------------------------------------------------
    path("users/create/",   UserCreateView.as_view(),  name="user-create"),
    path("users/patients/", PatientListView.as_view(), name="patient-list"),
    path("users/sales/",    SalesListView.as_view(),   name="sales-list"),

    # -- Clinics -------------------------------------------------------------
    path("clinics/", ClinicListCreateView.as_view(), name="clinics"),

    # -- Doctors -------------------------------------------------------------
    path("doctors/",
         DoctorListView.as_view(), name="doctor-list"),
    path("doctor/availability/<int:doctor_id>/",
         DoctorAvailabilityView.as_view(), name="doctor-availability"),
    path("doctor/set-availability/",
         DoctorAvailabilityView.as_view(), name="doctor-set-availability"),
    path("doctor/available/<int:doctor_id>/",
         DoctorAvailabilityCheckView.as_view(), name="doctor-available"),
    path("doctor/slots/<int:doctor_id>/",
         DoctorAvailableSlotsView.as_view(), name="doctor-slots"),

    # -- Sales availability --------------------------------------------------
    path("sales/availability/<int:sales_id>/",
         SalesAvailabilityView.as_view(), name="sales-availability"),
    path("sales/set-availability/",
         SalesAvailabilityView.as_view(), name="sales-set-availability"),
    path("sales/slots/<int:sales_id>/",
         SalesAvailableSlotsView.as_view(), name="sales-slots"),

    # -- Appointments / meetings (all STATIC paths before wildcards) ---------
    path("book-appointment/",
         MeetingBookView.as_view(), name="book-appointment"),

    path("doctor/appointments/",
         DoctorAppointmentListView.as_view(), name="doctor-appointments"),
    path("doctor/past-meetings/",
         DoctorPastMeetingsView.as_view(), name="doctor-past-meetings"),
    path("patient/appointments/",
         PatientAppointmentListView.as_view(), name="patient-appointments"),
    path("meeting/sales/",
         SalesAppointmentListView.as_view(), name="sales-appointments"),
    path("meetings/",
         MeetingListView.as_view(), name="meeting-list"),
    path("meeting/start/",
         MeetingStartView.as_view(), name="meeting-start"),
    path("meeting/direct-entry/",
         DirectRoomEntryView.as_view(), name="meeting-direct-entry"),
    path("meeting/end/",
         MeetingEndView.as_view(), name="meeting-end"),
    path("meeting/chat/",                               # ← STATIC — must be before wildcard
         MeetingChatAppendView.as_view(), name="meeting-chat"),
    path("append-transcript/",
         MeetingTranscriptAppendView.as_view(), name="append-transcript"),

    # -- Patient details -----------------------------------------------------
    path("patient_detials/", patient_details.as_view(), name="patient_details"),

    # -- Wildcard routes LAST (order matters!) --------------------------------
    path("meeting/<str:meeting_id>/history/",           # ← must come BEFORE plain wildcard
         MeetingHistoryView.as_view(), name="meeting-history"),
    path("meeting/<str:meeting_id>/",
         MeetingDetailView.as_view(), name="meeting-detail"),
]