// src/components/DoctorHome.js

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL as API } from "../config";
import { Calendar } from "rsuite";
import "rsuite/dist/rsuite.min.css";
import "./DoctorHome.css";

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ── Locale-safe date string (avoids UTC-shift bug) ─────────────────────────
const toDateStr = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const to12h = (time24) => {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
};

const to24h = (t12) => {
  if (!t12) return "00:00";
  const match = t12.match(/^(\d+):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "00:00";
  let [, hStr, mStr, ampm] = match;
  let h = parseInt(hStr, 10);
  if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mStr}`;
};

const timeFrom = (dt) => {
  if (!dt) return "";
  return to12h(dt.split("T")[1]?.slice(0, 5));
};

export default function DoctorHome() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  const [section, setSection] = useState("calendar"); // "calendar" | "book"
  const [appointments, setAppointments] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filterClinic, setFilterClinic] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Availability state
  const [showAvail, setShowAvail] = useState(false);
  const [availDays, setAvailDays] = useState({ 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false });
  const [availClinic, setAvailClinic] = useState("");
  const [availStart, setAvailStart] = useState("9:00 AM");
  const [availEnd, setAvailEnd] = useState("5:00 PM");
  const [availMsg, setAvailMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Booking state
  const [bookClinic, setBookClinic] = useState("");
  const [bookType, setBookType] = useState("consultation");
  const [bookPatient, setBookPatient] = useState("");
  const [bookFirstName, setBookFirstName] = useState("");
  const [bookLastName, setBookLastName] = useState("");
  const [bookReason, setBookReason] = useState("");
  const [bookDate, setBookDate] = useState("");
  const [bookTime, setBookTime] = useState("");
  const [bookDepartment, setBookDepartment] = useState("");
  const [bookRemark, setBookRemark] = useState("");
  const [bookMsg, setBookMsg] = useState("");
  const [bookLoading, setBookLoading] = useState(false);

  useEffect(() => { if (!token) navigate("/"); }, [token, navigate]);

  const loadAppointments = useCallback(async () => {
    const url = filterClinic
      ? `${API}/api/doctor/appointments/?clinic=${filterClinic}`
      : `${API}/api/doctor/appointments/`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setAppointments(await r.json().then(d => Array.isArray(d) ? d : []));
    } catch (e) { console.error(e); }
  }, [token, filterClinic]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  useEffect(() => {
    fetch(`${API}/api/clinics/`)
      .then(r => r.json())
      .then(d => setClinics(Array.isArray(d) ? d : []))
      .catch(console.error);
  }, []);

  const appointmentsOnDate = (ds) => appointments.filter(a => a.scheduled_time?.startsWith(ds));
  const selectedAppts = selectedDate ? appointmentsOnDate(selectedDate) : [];
  const selected = selectedAppts[selectedIndex] || null;
  const closeCard = () => { setSelectedDate(null); setSelectedIndex(0); };

  // ── RSuite Calendar ────────────────────────────────────────────────────────
  const renderCell = (date) => {
    const appts = appointmentsOnDate(toDateStr(date));
    if (!appts.length) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", marginTop: 2 }}>
        {appts.slice(0, 3).map((_, i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#2563eb", display: "inline-block" }} />
        ))}
        {appts.length > 3 && <span style={{ fontSize: 9, color: "#94a3b8" }}>+{appts.length - 3}</span>}
      </div>
    );
  };

  const handleCalSelect = (date) => {
    const ds = toDateStr(date);
    const appts = appointmentsOnDate(ds);
    if (appts.length) { setSelectedDate(ds); setSelectedIndex(0); }
  };

  // ── Start appointment ──────────────────────────────────────────────────────
  const handleStartAppt = async (appt) => {
    if (!appt.meeting_id || !appt.room_id) {
      alert("Missing meeting ID or room ID — please refresh and try again."); return;
    }
    try {
      const res = await fetch(`${API}/api/meeting/direct-entry/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: appt.meeting_id, room_id: appt.room_id }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Cannot start appointment"); return; }
      navigate(`/room/${data.room_id}?meeting_id=${data.meeting_id}&role=doctor`);
    } catch (e) { alert("Error entering consultation room: " + e.message); }
  };

  // ── Appointment card ───────────────────────────────────────────────────────
  const renderCard = () => {
    if (!selected) return null;
    const appt = selected;
    const pp = appt.participants?.find(p => p.role === "patient") || {};
    const isEnded = appt.status === "ended";
    const total = selectedAppts.length;

    return (
      <div className="appt-card-overlay" onClick={closeCard}>
        <div className="appt-card" onClick={e => e.stopPropagation()}>
          <button className="card-close" onClick={closeCard}>✕</button>

          {total > 1 && (
            <div className="card-nav">
              <button disabled={selectedIndex === 0} onClick={() => setSelectedIndex(i => i - 1)}>‹</button>
              <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                Appointment {selectedIndex + 1} of {total}
              </span>
              <button disabled={selectedIndex === total - 1} onClick={() => setSelectedIndex(i => i + 1)}>›</button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: "#1e293b", fontWeight: 700 }}>🩺 Appointment Details</h3>
            {isEnded && <span className="badge-ended">COMPLETED</span>}
          </div>

          <div className="card-grid">
            <div className="card-field"><label>1. First Name</label>   <span>{appt.patient_name?.split(" ")[0] || "—"}</span></div>
            <div className="card-field"><label>2. Last Name</label>    <span>{appt.patient_name?.split(" ").slice(1).join(" ") || "—"}</span></div>
            <div className="card-field"><label>3. Sex at Birth</label> <span>{pp.sex || "—"}</span></div>
            <div className="card-field"><label>4. Mobile No.</label>   <span>{pp.mobile || "—"}</span></div>
            <div className="card-field"><label>5. Date of Birth</label><span>{pp.dob || "—"}</span></div>
            <div className="card-field"><label>6. Email ID</label>     <span>{pp.email || "—"}</span></div>
            <div className="card-field"><label>7. Department</label>   <span>{appt.department || "—"}</span></div>
            <div className="card-field"><label>8. Doctor</label>       <span>Dr. {appt.doctor_name || "—"}</span></div>
            <div className="card-field"><label>9. Reason</label>       <span>{appt.appointment_reason || "—"}</span></div>
            <div className="card-field"><label>10. Date</label>        <span>{appt.scheduled_time?.split("T")[0] || "—"}</span></div>
            <div className="card-field"><label>11. Time</label>        <span>{timeFrom(appt.scheduled_time)}</span></div>
            <div className="card-field"><label>12. Remark</label>      <span>{appt.remark || "—"}</span></div>
          </div>

          {isEnded ? (
            <div style={{ marginTop: 18, borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#64748b" }}>📝 Consultation Notes / Transcript</h4>
              <div className="transcript-box">
                {appt.speech_to_text || <em style={{ color: "#94a3b8" }}>No notes recorded for this session.</em>}
              </div>
            </div>
          ) : (
            <div className="card-start-row">
              <button className="btn-start-green" onClick={() => handleStartAppt(appt)}>
                📹 Start Appointment
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Availability ───────────────────────────────────────────────────────────
  const toggleDay = (idx) => setAvailDays(prev => ({ ...prev, [idx]: !prev[idx] }));
  const toggleAll = () => {
    const allOn = Object.values(availDays).every(Boolean);
    const next = {};
    for (let i = 0; i < 7; i++) next[i] = !allOn;
    setAvailDays(next);
  };

  const handleSetAvailability = async (e) => {
    e.preventDefault();
    setAvailMsg("");
    const selectedDays = Object.entries(availDays).filter(([, v]) => v).map(([k]) => parseInt(k));
    if (!selectedDays.length) { setAvailMsg("⚠ Please select at least one day."); return; }
    if (!availClinic) { setAvailMsg("⚠ Please select a clinic."); return; }
    const start24 = to24h(availStart);
    const end24 = to24h(availEnd);
    if (start24 >= end24) { setAvailMsg("⚠ End time must be after start time."); return; }
    setSaving(true);
    try {
      // Send sequentially — SQLite cannot handle concurrent parallel writes
      const errors = [];
      for (const day of selectedDays) {
        const res = await fetch(`${API}/api/doctor/set-availability/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ clinic: parseInt(availClinic), day_of_week: day, start_time: start24, end_time: end24 }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          errors.push(errData?.error || `Day ${day} failed`);
        }
      }
      if (errors.length === 0) {
        setAvailMsg(`✅ Availability saved for ${selectedDays.length} day${selectedDays.length > 1 ? "s" : ""}!`);
        setTimeout(() => { setShowAvail(false); setAvailMsg(""); }, 2000);
      } else {
        setAvailMsg(`⚠ Some days failed: ${errors.join("; ")}`);
      }
    } catch { setAvailMsg("⚠ Network error. Check if the backend is running."); }
    finally { setSaving(false); }
  };

  const handleDoctorBook = async (e) => {
    e.preventDefault();
    setBookMsg("");
    if (!bookClinic || !bookPatient || !bookDate || !bookTime) {
      setBookMsg("⚠ Please fill clinic, patient, date, and time."); return;
    }
    setBookLoading(true);
    try {
      const body = {
        appointment_type: bookType,
        appointment_reason: bookReason,
        scheduled_time: `${bookDate}T${bookTime}:00`,
        remark: bookRemark,
        department: bookDepartment,
        clinic: parseInt(bookClinic),
        patient: {
          username: bookPatient,
          first_name: bookFirstName,
          last_name: bookLastName,
        },
      };

      const res = await fetch(`${API}/api/book-appointment/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setBookMsg(`⚠ ${data.error || "Failed to book"}`); }
      else {
        setBookMsg("✅ Appointment booked successfully!");
        loadAppointments();
        setBookPatient(""); setBookFirstName(""); setBookLastName("");
        setBookReason(""); setBookDate(""); setBookTime("");
        setBookRemark(""); setBookDepartment("");
      }
    } catch (err) { setBookMsg("⚠ Server error: " + err.message); }
    finally { setBookLoading(false); }
  };

  const handleLogout = () => { localStorage.clear(); navigate("/"); };

  const timeOptions = [];
  for (let h = 0; h < 24; h++)
    for (const m of ["00", "30"]) {
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      timeOptions.push(`${h12}:${m} ${ampm}`);
    }

  // Today's date string for min attribute
  const todayStr = toDateStr(new Date());

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="doctor-container">

      {/* ── Professional Navbar ── */}
      <nav className="doctor-nav">

        {/* Brand */}
        <div className="nav-brand">
          <div className="nav-brand-icon">🩺</div>
          <div className="nav-brand-text">
            <span className="nav-brand-title">MedConsult</span>
            <span className="nav-brand-sub">Doctor Portal</span>
          </div>
        </div>

        {/* Nav Links */}
        <div className="nav-links">
          <button
            className={`nav-btn ${section === "calendar" && !showAvail ? "active" : ""}`}
            onClick={() => { setSection("calendar"); setShowAvail(false); }}
          >
          Calendar
          </button>

          <button
            className={`nav-btn ${section === "book" && !showAvail ? "active" : ""}`}
            onClick={() => { setSection("book"); setShowAvail(false); }}
          >
          Book appoinment
          </button>

          <button
            className={`nav-btn avail-btn ${showAvail ? "active" : ""}`}
            onClick={() => { setShowAvail(v => !v); setSection("calendar"); }}
          >
          Availability
          </button>

          <div className="nav-divider" />

          <button className="nav-logout" onClick={handleLogout}>
            🚪 Logout
          </button>
        </div>
      </nav>

      <main className="doctor-main">

        {/* ── Availability Panel ── */}
        {showAvail && (
          <div className="avail-panel">
            <h3>⏰ Set Your Working Hours</h3>
            <form onSubmit={handleSetAvailability} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>

              {/* Clinic */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Clinic</label>
                <select
                  value={availClinic}
                  onChange={e => setAvailClinic(e.target.value)}
                  required
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#1e293b", fontSize: 14, fontFamily: "Inter, sans-serif" }}
                >
                  <option value="">— Select Clinic —</option>
                  {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Day selector */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Working Days</label>
                  <button
                    type="button"
                    onClick={toggleAll}
                    style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
                  >
                    {Object.values(availDays).every(Boolean) ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {WEEK_DAYS.map((day, i) => (
                    <label
                      key={i}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 20,
                        border: `1px solid ${availDays[i] ? "#2563eb" : "#e2e8f0"}`,
                        background: availDays[i] ? "#2563eb" : "#ffffff",
                        color: availDays[i] ? "#ffffff" : "#64748b",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        transition: "all 0.15s",
                        userSelect: "none",
                      }}
                    >
                      <input type="checkbox" checked={!!availDays[i]} onChange={() => toggleDay(i)} style={{ display: "none" }} />
                      {day.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </div>

              {/* Time range */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Working Hours</label>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <select value={availStart} onChange={e => setAvailStart(e.target.value)} style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#1e293b", fontSize: 14, fontFamily: "Inter, sans-serif" }}>
                    {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 13 }}>to</span>
                  <select value={availEnd} onChange={e => setAvailEnd(e.target.value)} style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#1e293b", fontSize: 14, fontFamily: "Inter, sans-serif" }}>
                    {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                style={{ padding: "12px 24px", borderRadius: 8, border: "none", background: saving ? "#94a3b8" : "#2563eb", color: "#ffffff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, fontFamily: "Inter, sans-serif", transition: "background 0.2s" }}
              >
                {saving ? "Saving…" : "💾 Save Availability"}
              </button>
            </form>

            {availMsg && (
              <p style={{ marginTop: 12, fontWeight: 600, color: availMsg.startsWith("✅") ? "#16a34a" : "#dc2626", fontSize: 14 }}>
                {availMsg}
              </p>
            )}
          </div>
        )}

        {/* ── Calendar View ── */}
        {section === "calendar" && (
          <div className="cal-view">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1e293b" }}>📅 My Appointments</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Click a highlighted date to view appointment details.</p>
              </div>
              <select
                value={filterClinic}
                onChange={e => setFilterClinic(e.target.value)}
                style={{ padding: "9px 16px", borderRadius: 8, background: "#ffffff", border: "1px solid #e2e8f0", color: "#1e293b", fontWeight: 600, fontSize: 13, fontFamily: "Inter, sans-serif" }}
              >
                <option value="">All Clinics</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="rsuite-cal-wrapper">
              <Calendar bordered compact renderCell={renderCell} onSelect={handleCalSelect} />
            </div>

            {/* Upcoming list */}
            <div className="upcoming-list" style={{ marginTop: 32 }}>
              <h3 style={{ color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontWeight: 700 }}>
                All Appoinments ({appointments.length})
              </h3>
              {!appointments.length && (
                <p style={{ color: "#94a3b8", textAlign: "center", padding: "32px 0" }}>No appointments found.</p>
              )}
              <div style={{ display: "grid", gap: 10 }}>
                {appointments.slice(0, 10).map(a => (
                  <div
                    key={a.meeting_id}
                    className="upcoming-row"
                    onClick={() => { setSelectedDate(a.scheduled_time.split("T")[0]); setSelectedIndex(0); }}
                    style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "#2563eb", fontSize: 14 }}>
                        {a.scheduled_time.split("T")[0]} · {timeFrom(a.scheduled_time)}
                      </div>
                      <div style={{ color: "#334155", marginTop: 3, fontSize: 13 }}>
                        👤 {a.patient_name} — <span style={{ color: "#64748b" }}>{a.appointment_reason || "Consultation"}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#2563eb", background: "#eff6ff", padding: "4px 12px", borderRadius: 20, fontWeight: 700 }}>
                      {a.clinic_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Book for Patient Section ── */}
        {section === "book" && (
          <div className="book-section" style={{ maxWidth: 660, margin: "0 auto" }}>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1e293b" }}>📝 Book Appointment for Patient</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Fill in the patient details and appointment slot below.</p>
            </div>

            <form
              onSubmit={handleDoctorBook}
              style={{ display: "flex", flexDirection: "column", gap: 20, background: "#ffffff", padding: 32, borderRadius: 16, border: "1px solid #e5e9f0", boxShadow: "0 2px 16px rgba(0,0,0,0.06)" }}
            >
              {/* Row 1 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Patient Username *</label>
                  <input type="text" value={bookPatient} onChange={e => setBookPatient(e.target.value)} placeholder="e.g. jdoe123" required />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Appointment Type</label>
                  <select value={bookType} onChange={e => setBookType(e.target.value)}>
                    <option value="consultation">Consultation</option>
                    <option value="pathology">Pathology</option>
                    <option value="ultrasound">Ultrasound</option>
                    <option value="surgery">Surgery</option>
                  </select>
                </div>
              </div>

              {/* Row 2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>First Name</label>
                  <input type="text" value={bookFirstName} onChange={e => setBookFirstName(e.target.value)} placeholder="e.g. Gracy" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Last Name</label>
                  <input type="text" value={bookLastName} onChange={e => setBookLastName(e.target.value)} placeholder="e.g. Wade" />
                </div>
              </div>

              {/* Clinic */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Clinic *</label>
                <select value={bookClinic} onChange={e => setBookClinic(e.target.value)} required>
                  <option value="">— Choose clinic —</option>
                  {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Date + Time */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Date *</label>
                  <input type="date" value={bookDate} min={todayStr} onChange={e => setBookDate(e.target.value)} required />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Time *</label>
                  <input type="time" value={bookTime} onChange={e => setBookTime(e.target.value)} required />
                </div>
              </div>

              {/* Department + Reason */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Department</label>
                  <input type="text" value={bookDepartment} onChange={e => setBookDepartment(e.target.value)} placeholder="e.g. Cardiology" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Reason</label>
                  <input type="text" value={bookReason} onChange={e => setBookReason(e.target.value)} placeholder="e.g. Follow-up" />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Remark</label>
                <input type="text" value={bookRemark} onChange={e => setBookRemark(e.target.value)} placeholder="Any additional notes" />
              </div>

              <button
                type="submit"
                disabled={bookLoading}
                style={{ padding: "14px 24px", borderRadius: 10, border: "none", background: bookLoading ? "#94a3b8" : "#16a34a", color: "#ffffff", cursor: bookLoading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15, fontFamily: "Inter, sans-serif", transition: "background 0.2s", marginTop: 4 }}
              >
                {bookLoading ? "Booking…" : "✅ Confirm Appointment"}
              </button>

              {bookMsg && (
                <p style={{ textAlign: "center", margin: 0, fontWeight: 600, color: bookMsg.startsWith("✅") ? "#16a34a" : "#dc2626", fontSize: 14 }}>
                  {bookMsg}
                </p>
              )}
            </form>
          </div>
        )}

      </main>

      {selected && renderCard()}
    </div>
  );
}