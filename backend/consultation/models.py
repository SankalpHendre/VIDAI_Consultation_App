import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    ROLE_CHOICES = [
        ("admin",   "Admin"),
        ("doctor",  "Doctor"),
        ("sales",   "Sales"),
        ("patient", "Patient"),
    ]
    SEX_CHOICES = [
        ("M", "Male"),
        ("F", "Female"),
        ("O", "Other / Prefer not to say"),
    ]

    role          = models.CharField(max_length=10, choices=ROLE_CHOICES, default="patient")
    date_of_birth = models.DateField(null=True, blank=True)
    sex           = models.CharField(max_length=1, choices=SEX_CHOICES, null=True, blank=True)
    mobile        = models.CharField(max_length=20, null=True, blank=True)
    department    = models.CharField(max_length=100, null=True, blank=True)
    photo         = models.ImageField(upload_to="profile_photos/", null=True, blank=True)
    clinic        = models.ForeignKey(
        "Clinic", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="members",
    )

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.role})"


class Clinic(models.Model):
    clinic_id = models.CharField(max_length=50, unique=True)
    name      = models.CharField(max_length=100)

    def __str__(self):
        return f"{self.name} ({self.clinic_id})"


class DoctorAvailability(models.Model):
    """
    Shared availability table for doctors AND sales reps.
    - Doctor rows:  clinic is set  (doctor works at a specific clinic)
    - Sales rows:   clinic is NULL (sales meetings are not clinic-bound)
    """
    DAY_CHOICES = [
        (0, "Monday"), (1, "Tuesday"), (2, "Wednesday"),
        (3, "Thursday"), (4, "Friday"), (5, "Saturday"), (6, "Sunday"),
    ]

    doctor = models.ForeignKey(User, on_delete=models.CASCADE, related_name="availability")
    # CHANGED: null=True, blank=True so sales reps can omit clinic
    clinic = models.ForeignKey(
        Clinic, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="doctor_hours",
    )
    day_of_week = models.IntegerField(choices=DAY_CHOICES)
    start_time  = models.TimeField()
    end_time    = models.TimeField()

    class Meta:
        # SQL treats NULL as distinct in unique constraints, so a sales rep
        # gets one row per day (clinic=NULL) and doctors get one per (clinic, day).
        unique_together = ("doctor", "clinic", "day_of_week")
        ordering        = ["day_of_week", "start_time"]

    def __str__(self):
        clinic_str = self.clinic.name if self.clinic else "Sales (no clinic)"
        return (
            f"{self.doctor.get_full_name()} @ {clinic_str} "
            f"- {self.get_day_of_week_display()} {self.start_time}-{self.end_time}"
        )


class Meeting(models.Model):
    MEETING_TYPE_CHOICES = [
        ("CONSULT",       "Consultation"),
        ("SALES_MEETING", "Sales Meeting"),
        ("SALES",         "Sales"),
        ("DEMO",          "Demo"),
    ]
    APPOINTMENT_TYPE_CHOICES = [
        ("consultation",     "Consultation"),
        ("semen_collection", "Semen Collection"),
        ("pathology",        "Pathology"),
        ("ultrasound",       "Ultrasound"),
        ("surgery",          "Surgery"),
        ("sales_meeting",    "Sales Meeting"),  # NEW
    ]
    STATUS_CHOICES = [
        ("scheduled", "Scheduled"),
        ("started",   "Started"),
        ("ended",     "Ended"),
        ("cancelled", "Cancelled"),
    ]

    meeting_id         = models.AutoField(primary_key=True)
    room_id            = models.CharField(max_length=120, unique=True, blank=True)
    meeting_type       = models.CharField(max_length=20, choices=MEETING_TYPE_CHOICES, default="CONSULT")
    appointment_type   = models.CharField(max_length=30, choices=APPOINTMENT_TYPE_CHOICES, default="consultation")
    scheduled_time     = models.DateTimeField()
    duration           = models.IntegerField(default=30)
    participants       = models.JSONField(default=list)

    patient  = models.ForeignKey(User,   on_delete=models.SET_NULL, null=True, blank=True, related_name="patient_meetings")
    doctor   = models.ForeignKey(User,   on_delete=models.SET_NULL, null=True, blank=True, related_name="doctor_meetings")
    sales    = models.ForeignKey(User,   on_delete=models.SET_NULL, null=True, blank=True, related_name="sales_meetings")
    clinic   = models.ForeignKey(Clinic, on_delete=models.SET_NULL, null=True, blank=True, related_name="meetings")

    appointment_reason = models.CharField(max_length=300, blank=True)
    department         = models.CharField(max_length=100, blank=True)
    remark             = models.TextField(blank=True)
    speech_to_text     = models.TextField(blank=True)
    chat_log           = models.JSONField(default=list, blank=True)
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default="scheduled")
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.room_id:
            self.room_id = f"meet-{uuid.uuid4()}"
        super().save(*args, **kwargs)

    def __str__(self):
        patient_name = self.patient.get_full_name() if self.patient else "Unknown"
        if self.appointment_type == "sales_meeting":
            sales_name = self.sales.get_full_name() if self.sales else "Unknown"
            return f"SalesMeeting {self.meeting_id}: {patient_name}   {sales_name} @ {self.scheduled_time}"
        doctor_name = self.doctor.get_full_name() if self.doctor else "Unknown"
        return f"Meeting {self.meeting_id}: {patient_name} with Dr.{doctor_name} @ {self.scheduled_time}"