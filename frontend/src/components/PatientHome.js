// src/components/PatientHome.js

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL as API } from "../config";
import { Calendar } from "rsuite";
import "rsuite/dist/rsuite.min.css";
import "./PatientHome.css";

const toDateStr = (d) => {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day   = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const todayStr = () => toDateStr(new Date());

const to12h = (time24) => {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
};

const timeFrom = (dt) => {
  if (!dt) return "";
  return to12h(dt.split("T")[1]?.slice(0, 5));
};

const SALES_MEETING_TYPE = "sales_meeting";
const isSalesMtgType = (t) => t === SALES_MEETING_TYPE;

// =============================================================================
// Meeting window helpers
// =============================================================================

const getMeetingActiveStart = (appt) => {
  if (!appt?.scheduled_time) return null;
  return new Date(appt.scheduled_time).getTime() - 5 * 60 * 1000;
};

const getMeetingExpiry = (appt) => {
  if (!appt?.scheduled_time) return null;
  const duration = appt.duration || 30;
  return new Date(appt.scheduled_time).getTime() + duration * 60 * 1000;
};

const isMeetingJoinable = (appt) => {
  const now    = Date.now();
  const opens  = getMeetingActiveStart(appt);
  const closes = getMeetingExpiry(appt);
  return opens !== null && closes !== null && now >= opens && now <= closes;
};

const isEffectivelyEnded = (appt) => {
  if (appt.status === "ended") return true;
  const closes = getMeetingExpiry(appt);
  return closes !== null && Date.now() > closes;
};

// =============================================================================
// Transcript renderer
// =============================================================================

const SPEAKER_RE = /^((?:Doctor|Patient|Sales)\s*\([^)]+\))\s*:\s*(.*)/i;

const renderTranscript = (text) => {
  if (!text || !text.trim()) {
    return <em style={{ color: "#64748b" }}>No transcript recorded.</em>;
  }
  const lines = text.split("\n").filter(l => l.trim());
  return lines.map((line, idx) => {
    const match = line.trim().match(SPEAKER_RE);
    if (match) {
      const isDoctor = match[1].toLowerCase().startsWith("doctor");
      return (
        <div key={idx} style={{ display: "flex", marginBottom: 8, alignItems: "flex-start", gap: 4 }}>
          <span style={{
            minWidth: 160, flexShrink: 0,
            fontWeight: 700, fontSize: 13,
            color: isDoctor ? "#3b82f6" : "#4ade80",
          }}>
            {match[1]}
          </span>
          <span style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>
            : {match[2]}
          </span>
        </div>
      );
    }
    return (
      <div key={idx} style={{ fontSize: 13, color: "#94a3b8", marginBottom: 5 }}>
        {line}
      </div>
    );
  });
};

// =============================================================================
// Component
// =============================================================================

export default function PatientHome() {
  const navigate = useNavigate();
  const token    = localStorage.getItem("token");
  const fullName = localStorage.getItem("full_name") || "Patient";

  const [section, setSection]         = useState("calendar");
  const [appointments, setAppointments] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Booking form state
  const [clinics, setClinics]         = useState([]);
  const [doctors, setDoctors]         = useState([]);
  const [salesUsers, setSalesUsers]   = useState([]);
  const [bookType, setBookType]       = useState("consultation");
  const [bookClinic, setBookClinic]   = useState("");
  const [bookDoctor, setBookDoctor]   = useState("");
  const [bookSales, setBookSales]     = useState("");
  const [bookReason, setBookReason]   = useState("");
  const [bookDate, setBookDate]       = useState("");
  const [bookTime, setBookTime]       = useState("");
  const [bookDepartment, setBookDepartment] = useState("");
  const [bookRemark, setBookRemark]   = useState("");
  const [bookDuration, setBookDuration] = useState(30);
  const [bookMsg, setBookMsg]         = useState("");
  // Task 4: keep availSlots for informational hint only (no grid)
  const [availSlots, setAvailSlots]   = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [noSlotsMsg, setNoSlotsMsg]   = useState("");

  const isSalesMeeting = isSalesMtgType(bookType);

  useEffect(() => { if (!token) navigate("/"); }, [token, navigate]);

  const loadAppointments = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/patient/appointments/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setAppointments(res.ok && Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setAppointments([]); }
  }, [token]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // Re-check meeting window every 30 s
  useEffect(() => {
    const iv = setInterval(() => setAppointments(prev => [...prev]), 30_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/clinics/`)
      .then(r => r.json())
      .then(d => setClinics(Array.isArray(d) ? d : []))
      .catch(() => setClinics([]));
  }, []);

  useEffect(() => {
    if (!bookClinic) { setDoctors([]); return; }
    fetch(`${API}/api/doctors/?clinic=${bookClinic}`)
      .then(r => r.json())
      .then(d => setDoctors(Array.isArray(d) ? d : []))
      .catch(() => setDoctors([]));
  }, [bookClinic]);

  useEffect(() => {
    fetch(`${API}/api/users/sales/`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setSalesUsers(Array.isArray(d) ? d : []))
      .catch(() => setSalesUsers([]));
  }, [token]);

  useEffect(() => {
    setBookClinic(""); setBookDoctor(""); setBookSales("");
    setBookDate(""); setBookTime("");
    setAvailSlots([]); setNoSlotsMsg(""); setBookMsg("");
  }, [bookType]);

  // Load available slots for hint display (not used for selection grid)
  useEffect(() => {
    if (isSalesMeeting) return;
    setAvailSlots([]); setNoSlotsMsg("");
    if (!bookDoctor || !bookDate) return;
    setSlotsLoading(true);
    const params = new URLSearchParams({ date: bookDate });
    if (bookClinic) params.set("clinic", bookClinic);
    fetch(`${API}/api/doctor/slots/${bookDoctor}/?${params}`)
      .then(r => r.json())
      .then(d => {
        const slots = d.slots || [];
        setAvailSlots(slots);
        setNoSlotsMsg(slots.length ? "" : "ℹ No pre-set slots — any time is available.");
      })
      .catch(() => setNoSlotsMsg(""))
      .finally(() => setSlotsLoading(false));
  }, [bookDoctor, bookDate, bookClinic, isSalesMeeting]);

  useEffect(() => {
    if (!isSalesMeeting) return;
    setAvailSlots([]); setNoSlotsMsg("");
    if (!bookSales || !bookDate) return;
    setSlotsLoading(true);
    fetch(`${API}/api/sales/slots/${bookSales}/?date=${bookDate}`)
      .then(r => r.json())
      .then(d => {
        const slots = d.slots || [];
        setAvailSlots(slots);
        setNoSlotsMsg(slots.length ? "" : "ℹ No pre-set slots — any time is available.");
      })
      .catch(() => setNoSlotsMsg(""))
      .finally(() => setSlotsLoading(false));
  }, [bookSales, bookDate, isSalesMeeting]);

  const appointmentsOnDate = (ds) =>
    appointments.filter(a => a.scheduled_time?.startsWith(ds));

  const selectedAppts = selectedDate ? appointmentsOnDate(selectedDate) : [];
  const selected      = selectedAppts[selectedIndex] || null;

  const handleLogout = () => { localStorage.clear(); navigate("/"); };

  const todayAppointments = appointments.filter(a =>
    a.scheduled_time?.startsWith(todayStr())
  );

  // ── RSuite Calendar ────────────────────────────────────────────────────────
  const renderCell = (date) => {
    const appts = appointmentsOnDate(toDateStr(date));
    if (!appts.length) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", marginTop: 2 }}>
        {appts.slice(0, 3).map((a, i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: a.appointment_type === SALES_MEETING_TYPE ? "#f59e0b" : "#4ade80",
            display: "inline-block",
          }} />
        ))}
        {appts.length > 3 && <span style={{ fontSize: 9, color: "#94a3b8" }}>+{appts.length - 3}</span>}
      </div>
    );
  };

  const handleCalSelect = (date) => {
    const ds    = toDateStr(date);
    const appts = appointmentsOnDate(ds);
    if (appts.length) { setSelectedDate(ds); setSelectedIndex(0); }
  };

  // ── Appointment card ───────────────────────────────────────────────────────
  const renderAppointmentCard = () => {
    if (!selected) return null;
    const appt      = selected;
    const pp        = appt.participants?.find(p => p.role === "patient") || {};
    const isSalesMtg = appt.appointment_type === SALES_MEETING_TYPE;

    const ended    = isEffectivelyEnded(appt);
    const joinable = isMeetingJoinable(appt);
    const total    = selectedAppts.length;

    const opens         = getMeetingActiveStart(appt);
    const now           = Date.now();
    const tooEarly      = opens !== null && now < opens;
    const minsUntilOpen = tooEarly ? Math.ceil((opens - now) / 60000) : 0;

    const handleStart = async () => {
      if (!joinable) return;
      try {
        const res = await fetch(`${API}/api/meeting/direct-entry/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meeting_id: appt.meeting_id, room_id: appt.room_id }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || "Cannot join appointment"); return; }
        navigate(`/room/${data.room_id}?meeting_id=${data.meeting_id}&role=patient`);
      } catch (e) { alert("Error entering room: " + e.message); }
    };

    return (
      <div className="appt-card-overlay" onClick={() => { setSelectedDate(null); setSelectedIndex(0); }}>
        <div className="appt-card" onClick={e => e.stopPropagation()}>
          <button className="card-close" onClick={() => { setSelectedDate(null); setSelectedIndex(0); }}>✕</button>

          {total > 1 && (
            <div className="card-nav">
              <button disabled={selectedIndex === 0} onClick={() => setSelectedIndex(i => i - 1)}>‹</button>
              <span>Appointment {selectedIndex + 1} of {total}</span>
              <button disabled={selectedIndex === total - 1} onClick={() => setSelectedIndex(i => i + 1)}>›</button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>{isSalesMtg ? "💼 Sales Meeting" : "📋 Appointment Details"}</h3>
            {ended && <span className="badge-ended">COMPLETED</span>}
            {isSalesMtg && !ended && (
              <span style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "3px 10px", borderRadius: 20, fontSize: "0.76rem", fontWeight: 700 }}>
                SALES MEETING
              </span>
            )}
          </div>

          <div className="card-grid">
            <div className="card-field"><label>1. First Name</label><span>{appt.patient_name?.split(" ")[0] || "—"}</span></div>
            <div className="card-field"><label>2. Last Name</label> <span>{appt.patient_name?.split(" ").slice(1).join(" ") || "—"}</span></div>
            {isSalesMtg ? (
              <>
                <div className="card-field"><label>3. Sales Rep</label>  <span>{appt.sales_name || "—"}</span></div>
                <div className="card-field"><label>4. Mobile No.</label> <span>{pp.mobile || "—"}</span></div>
              </>
            ) : (
              <>
                <div className="card-field"><label>3. Sex at Birth</label><span>{pp.sex || "—"}</span></div>
                <div className="card-field"><label>4. Mobile No.</label>  <span>{pp.mobile || "—"}</span></div>
              </>
            )}
            <div className="card-field"><label>5. Date of Birth</label> <span>{pp.dob || "—"}</span></div>
            <div className="card-field"><label>6. Email ID</label>       <span>{pp.email || "—"}</span></div>
            {!isSalesMtg && (
              <>
                <div className="card-field"><label>7. Department</label><span>{appt.department || "—"}</span></div>
                <div className="card-field"><label>8. Doctor</label>    <span>{appt.doctor_name ? `Dr. ${appt.doctor_name}` : "—"}</span></div>
              </>
            )}
            <div className="card-field"><label>{isSalesMtg ? "7."  : "9."}  Reason</label> <span>{appt.appointment_reason || "—"}</span></div>
            <div className="card-field"><label>{isSalesMtg ? "8."  : "10."} Date</label>   <span>{appt.scheduled_time?.split("T")[0] || "—"}</span></div>
            <div className="card-field"><label>{isSalesMtg ? "9."  : "11."} Time</label>   <span>{timeFrom(appt.scheduled_time)}</span></div>
            <div className="card-field"><label>{isSalesMtg ? "10." : "12."} Remark</label> <span>{appt.remark || "—"}</span></div>
          </div>

          {ended ? (
            <div style={{ marginTop: 15, borderTop: "1px solid #334155", paddingTop: 10 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "#94a3b8" }}>📝 Consultation Transcript</h4>
              <div className="transcript-box" style={{ maxHeight: 260, overflowY: "auto" }}>
                {renderTranscript(appt.speech_to_text)}
              </div>
            </div>
          ) : (
            <div className="card-start-row">
              {tooEarly && (
                <p style={{ textAlign: "center", marginBottom: 8, fontSize: 13, color: "#f59e0b" }}>
                  ⏰ Opens in {minsUntilOpen} min ({new Date(opens).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                </p>
              )}
              {joinable ? (
                <button className="btn-start-green" onClick={handleStart}>📹 Join Appointment</button>
              ) : (
                <button className="btn-start-grey" disabled>
                  {tooEarly ? "⏰ Not Yet Active" : "🚫 Meeting Expired"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Task 4: Time picker — native input, availability shown as one line ──────
  const renderTimePicker = () => {
    const prereqMissing = (!isSalesMeeting && (!bookDoctor || !bookDate))
      || (isSalesMeeting && (!bookSales || !bookDate));

    // Summarise available slots as a single readable range string, e.g. "9:00 AM – 5:00 PM"
    const availHint = (() => {
      if (!availSlots.length) return null;
      const first = to12h(availSlots[0]);
      const last  = to12h(availSlots[availSlots.length - 1]);
      return first === last ? first : `${first} – ${last}`;
    })();

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          type="time"
          value={bookTime}
          onChange={e => setBookTime(e.target.value)}
          required
          disabled={prereqMissing}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: prereqMissing ? "#f1f5f9" : "#f8fafc",
            color: prereqMissing ? "#94a3b8" : "#1e293b",
            fontSize: 14,
            width: "100%",
            boxSizing: "border-box",
            cursor: prereqMissing ? "not-allowed" : "pointer",
          }}
        />
        {/* Single-line availability hint */}
        {!prereqMissing && slotsLoading && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Checking availability…</p>
        )}
        {!prereqMissing && !slotsLoading && availHint && (
          <p style={{ fontSize: 12, color: "#3b82f6", margin: 0 }}>
            🕐 Doctor available: <strong>{availHint}</strong>
          </p>
        )}
        {!prereqMissing && !slotsLoading && noSlotsMsg && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, fontStyle: "italic" }}>{noSlotsMsg}</p>
        )}
        {prereqMissing && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, fontStyle: "italic" }}>
            {isSalesMeeting ? "Select a sales rep and date first." : "Select a doctor and date first."}
          </p>
        )}
      </div>
    );
  };

  // ── Booking submit ─────────────────────────────────────────────────────────
  const handleBook = async (e) => {
    e.preventDefault();
    setBookMsg("");
    if (isSalesMeeting
      ? (!bookSales || !bookDate || !bookTime)
      : (!bookClinic || !bookDoctor || !bookDate || !bookTime)) {
      setBookMsg("⚠ Please fill all required fields."); return;
    }
    try {
      const body = {
        appointment_type:   bookType,
        appointment_reason: bookReason,
        scheduled_time:     `${bookDate}T${bookTime}:00`,
        duration:           parseInt(bookDuration),
        remark:             bookRemark,
      };
      if (isSalesMeeting) {
        body.sales_id = parseInt(bookSales);
      } else {
        body.clinic     = parseInt(bookClinic);
        const doc       = doctors.find(d => String(d.id) === String(bookDoctor));
        body.doctor     = doc ? { username: doc.username, id: doc.id } : null;
        body.department = bookDepartment;
        if (bookSales) body.sales_id = parseInt(bookSales);
      }
      const res = await fetch(`${API}/api/book-appointment/`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setBookMsg(`⚠ ${data.error || "Booking failed"}`); return; }
      setBookMsg(`✅ ${isSalesMeeting ? "Sales meeting" : "Appointment"} booked successfully!`);
      loadAppointments();
      setBookType("consultation"); setBookClinic(""); setBookDoctor(""); setBookSales("");
      setBookReason(""); setBookDate(""); setBookTime(""); setBookRemark("");
      setBookDepartment(""); setAvailSlots([]); setNoSlotsMsg("");
    } catch (e) { setBookMsg("⚠ Server error: " + e.message); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="patient-layout">
      <nav className="patient-nav">
        <div className="nav-profile">
          <div className="nav-avatar">👤</div>
          <p className="nav-greeting">Hi, {fullName}</p>
        </div>
        <button className={`nav-btn ${section === "calendar" ? "active" : ""}`} onClick={() => setSection("calendar")}>📅 Calendar</button>
        <button className={`nav-btn ${section === "book" ? "active" : ""}`}     onClick={() => setSection("book")}>📝 Book Appointment</button>
        <button className={`nav-btn ${section === "join" ? "active" : ""}`}     onClick={() => setSection("join")}>📹 Join Appointment</button>
        <button className="nav-logout" onClick={handleLogout}>🚪 Logout</button>
      </nav>

      <main className="patient-main">

        {/* ── CALENDAR SECTION ── */}
        {section === "calendar" && (
          <div>
            <h2>📅 Upcoming Appointments</h2>
            <p className="section-hint">Click on a highlighted date to see appointment details.</p>
            <div className="rsuite-cal-wrapper">
              <Calendar bordered compact renderCell={renderCell} onSelect={handleCalSelect} />
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#4ade80", marginRight: 4 }} />Consultation</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", marginRight: 4 }} />Sales Meeting</span>
            </div>
            {appointments.length === 0 && (
              <p className="empty-msg" style={{ textAlign: "center", marginTop: 16, color: "#64748b" }}>
                No appointments found. Book one using the "Book Appointment" tab.
              </p>
            )}
          </div>
        )}

        {/* ── BOOK SECTION ── */}
        {section === "book" && (
          <div className="book-section">
            <h2>📝 Book an Appointment</h2>
            <form className="book-form" onSubmit={handleBook}>

              <label>Appointment Type *</label>
              <select value={bookType} onChange={e => setBookType(e.target.value)}>
                <option value="consultation">Consultation</option>
                <option value="semen_collection">Semen Collection</option>
                <option value="pathology">Pathology</option>
                <option value="ultrasound">Ultrasound</option>
                <option value="surgery">Surgery</option>
                <option value="sales_meeting">Sales Meeting</option>
              </select>

              {isSalesMeeting && (
                <>
                  <div className="book-type-badge sales-meeting-badge">💼 Sales Meeting — No clinic or doctor required</div>
                  <label>Select Sales Representative *</label>
                  <select value={bookSales} onChange={e => setBookSales(e.target.value)} required>
                    <option value="">— Choose a sales rep —</option>
                    {salesUsers.map(s => <option key={s.id} value={s.id}>{s.full_name || s.username}{s.clinic ? ` · ${s.clinic}` : ""}</option>)}
                  </select>
                </>
              )}

              {!isSalesMeeting && (
                <>
                  <label>Select Clinic *</label>
                  <select value={bookClinic} onChange={e => { setBookClinic(e.target.value); setBookDoctor(""); }} required>
                    <option value="">— Choose clinic —</option>
                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <label>Select Doctor *</label>
                  <select value={bookDoctor} onChange={e => setBookDoctor(e.target.value)} disabled={!bookClinic} required>
                    <option value="">— Choose doctor —</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.full_name}{d.department ? ` (${d.department})` : ""}</option>)}
                  </select>

                  <label>Assign Sales Rep <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></label>
                  <select value={bookSales} onChange={e => setBookSales(e.target.value)}>
                    <option value="">— No sales rep —</option>
                    {salesUsers.map(s => <option key={s.id} value={s.id}>{s.full_name || s.username}{s.clinic ? ` · ${s.clinic}` : ""}</option>)}
                  </select>
                  {bookSales && <p style={{ fontSize: 12, color: "#f59e0b", margin: "-6px 0 6px" }}>⚠ Sales rep will be included in the meeting room.</p>}

                  <label>Department</label>
                  <input type="text" placeholder="e.g. Cardiology" value={bookDepartment} onChange={e => setBookDepartment(e.target.value)} />
                </>
              )}

              <label>Reason</label>
              <input type="text" placeholder="e.g. Chest pain, routine checkup" value={bookReason} onChange={e => setBookReason(e.target.value)} />

              <label>Date *</label>
              <input type="date" value={bookDate} min={todayStr()} onChange={e => setBookDate(e.target.value)} required />

              <label>Time *</label>
              {renderTimePicker()}

              <label>Duration</label>
              <select value={bookDuration} onChange={e => setBookDuration(e.target.value)}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
              </select>

              <label>Remark</label>
              <textarea placeholder="Any special notes" value={bookRemark} onChange={e => setBookRemark(e.target.value)} rows={3} />

              <button type="submit" className="btn-book" disabled={!bookTime}>✅ Confirm Booking</button>
              {bookMsg && <p className="book-msg">{bookMsg}</p>}
            </form>
          </div>
        )}

        {/* ── JOIN SECTION ── */}
        {section === "join" && (
          <div>
            <h2>📹 Today's Appointments</h2>
            <p className="section-hint">Appointments for today ({todayStr()}).</p>
            {todayAppointments.length === 0
              ? <p className="empty-msg">No appointments scheduled for today.</p>
              : (
                <div className="join-list">
                  {todayAppointments.map(appt => (
                    <TodayAppointmentRow key={appt.meeting_id} appt={appt} navigate={navigate} />
                  ))}
                </div>
              )
            }
          </div>
        )}
      </main>

      {selected && renderAppointmentCard()}
    </div>
  );
}

// ── Today appointment row ─────────────────────────────────────────────────────
function TodayAppointmentRow({ appt, navigate }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  const isSalesMtg = appt.appointment_type === SALES_MEETING_TYPE;
  const ended      = isEffectivelyEnded(appt);
  const joinable   = isMeetingJoinable(appt);
  const opens      = getMeetingActiveStart(appt);
  const tooEarly   = opens !== null && Date.now() < opens;

  const handleJoin = async () => {
    if (!joinable) return;
    try {
      const res = await fetch(`${API}/api/meeting/direct-entry/`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ meeting_id: appt.meeting_id, room_id: appt.room_id }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Cannot join"); return; }
      navigate(`/room/${data.room_id}?meeting_id=${data.meeting_id}&role=patient`);
    } catch (e) { alert("Error joining room: " + e.message); }
  };

  const time = to12h(appt.scheduled_time?.split("T")[1]?.slice(0, 5) || "");

  return (
    <div className="join-row">
      <div className="join-info">
        <strong>{time}</strong>
        {isSalesMtg
          ? <span>💼 {appt.sales_name || "Sales Rep"}</span>
          : <span>Dr. {appt.doctor_name}</span>}
        <span>{appt.appointment_reason || (isSalesMtg ? "Sales Meeting" : "Consultation")}</span>
        {appt.clinic_name && <span className="join-clinic">{appt.clinic_name}</span>}
        {isSalesMtg && <span className="join-clinic" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>Sales</span>}
      </div>

      {ended ? (
        <span className="badge-ended-sm">Ended</span>
      ) : joinable ? (
        <button className="btn-join green" onClick={handleJoin}>📹 Join</button>
      ) : (
        <button className="btn-join grey" disabled>
          {tooEarly
            ? `⏰ Opens ${new Date(opens).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "🚫 Expired"}
        </button>
      )}
    </div>
  );
}