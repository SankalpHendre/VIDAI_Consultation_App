# consultation/urls.py

from django.urls import path
from .views import (
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
    DoctorPastMeetingsView,          # ← Task 2
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

    # -- User management ------------------------------------------------------
    path("users/create/",   UserCreateView.as_view(),  name="user-create"),
    path("users/patients/", PatientListView.as_view(), name="patient-list"),
    path("users/sales/",    SalesListView.as_view(),   name="sales-list"),

    # -- Clinics --------------------------------------------------------------
    path("clinics/", ClinicListCreateView.as_view(), name="clinics"),

    # -- Doctors --------------------------------------------------------------
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

    # -- Sales availability ---------------------------------------------------
    path("sales/availability/<int:sales_id>/",
         SalesAvailabilityView.as_view(), name="sales-availability"),
    path("sales/set-availability/",
         SalesAvailabilityView.as_view(), name="sales-set-availability"),
    path("sales/slots/<int:sales_id>/",
         SalesAvailableSlotsView.as_view(), name="sales-slots"),

    # -- Appointments / meetings (static paths BEFORE wildcard) --------------
    path("book-appointment/",
         MeetingBookView.as_view(), name="book-appointment"),

    path("doctor/appointments/",
         DoctorAppointmentListView.as_view(), name="doctor-appointments"),
    path("doctor/past-meetings/",
         DoctorPastMeetingsView.as_view(), name="doctor-past-meetings"),   # ← Task 2
    path("patient/appointments/",
         PatientAppointmentListView.as_view(), name="patient-appointments"),
    path("meeting/sales/",
         SalesAppointmentListView.as_view(), name="sales-appointments"),

    path("meetings/",
         MeetingListView.as_view(), name="meeting-list"),
    path("meeting/start/",
         MeetingStartView.as_view(), name="meeting-start"),

    # -- Direct entry --------------------------------------------------------
    path("meeting/direct-entry/",
         DirectRoomEntryView.as_view(), name="meeting-direct-entry"),

    path("meeting/end/",
         MeetingEndView.as_view(), name="meeting-end"),
    path("append-transcript/",
         MeetingTranscriptAppendView.as_view(), name="append-transcript"),

    # -- Wildcard LAST --------------------------------------------------------
    path("meeting/<str:meeting_id>/",
         MeetingDetailView.as_view(), name="meeting-detail"),
]