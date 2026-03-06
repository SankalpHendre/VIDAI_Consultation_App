import React, { useState, useEffect } from 'react'
import './EndCall.css'
import { IoIosCloseCircle } from "react-icons/io";
import { MdCallEnd } from "react-icons/md";
import { useNavigate } from 'react-router-dom';
import ViewTranscript from './ViewTranscript';
import PatientFeedback from './PatientFeedback';

const EndCall = ({ duration, summary, transcript, meetingId }) => {
    const navigate = useNavigate();
    const role = localStorage.getItem("role");
    const isDoctor = role === "doctor";
    const isPatient = role === "patient";

    const [fetchedTranscript, setFetchedTranscript] = useState(transcript || "");
    const [loadingTranscript, setLoadingTranscript] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);

    // Resolve meeting ID — try prop first, then localStorage (UUID), then URL param
    const resolvedMeetingId =
        meetingId ||
        localStorage.getItem("current_meeting_uuid") ||
        localStorage.getItem("meeting_id") ||
        new URLSearchParams(window.location.search).get("meeting_id");

    useEffect(() => {
        if (!resolvedMeetingId) return;

        const token = localStorage.getItem("access_token");
        setLoadingTranscript(true);

        fetch(`/api/meeting/${resolvedMeetingId}/`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            }
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                const text = data.speech_to_text || data.transcript || "";
                setFetchedTranscript(text);
            })
            .catch(err => {
                console.error("Transcript fetch error:", err);
                if (transcript) setFetchedTranscript(transcript);
            })
            .finally(() => setLoadingTranscript(false));

    }, [resolvedMeetingId]);

    const goHome = () => {
        localStorage.removeItem("current_meeting_uuid");
        localStorage.removeItem("meeting_id");
        if (isDoctor) navigate("/doctor", { replace: true });
        else if (isPatient) navigate("/patient", { replace: true });
        else navigate("/", { replace: true });
    };

    const viewTranscript = () => {
        if (loadingTranscript) {
            alert("Still loading transcript, please wait...");
            return;
        }
        setShowTranscript(true);
    };

    const fmt = s =>
        `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    // ── Patient sees feedback form immediately ──
    if (isPatient) {
        return (
            <PatientFeedback
                duration={duration}
                summary={summary}
                onClose={goHome}
            />
        );
    }

    // ── Doctor clicks "View Transcript" → swap inline ──
    if (showTranscript) {
        return (
            <ViewTranscript
                transcript={fetchedTranscript}
                onClose={() => setShowTranscript(false)}
            />
        );
    }

    // ── Doctor end-call screen ──
    return (
        <div className="wrapper">
            <div className='end-container'>

                <div className="end-navbar">
                    <div className="end-cross" onClick={goHome}>
                        <IoIosCloseCircle size={25} />
                    </div>
                </div>

                <div className="end-info">
                    <div className="end-call-info">
                        <div className="end-call-icon">
                            <MdCallEnd size={25} />
                        </div>
                        <div className='end-call-text'>Call Ended</div>
                        <div className="end-call-dur">
                            <div style={{ fontFamily: 'Montserrat', fontWeight: '500', fontSize: '13px', color: '#9E9E9E' }}>
                                Call Duration :
                            </div>
                            <div style={{ fontFamily: 'Montserrat', fontWeight: '600', fontSize: '15px', color: 'black' }}>
                                {fmt(duration || 0)}
                            </div>
                        </div>
                    </div>

                    <div className="end-summary">
                        <div style={{ fontFamily: 'Montserrat', fontWeight: '600', fontSize: '14px', color: 'black', marginBottom: '8px' }}>
                            AI Call Summary
                        </div>
                        <ul style={{ fontFamily: 'Montserrat', fontWeight: '500', fontSize: '12px', color: '#505050', margin: 0, paddingLeft: '16px' }}>
                            {summary && summary.length > 0 ? (
                                summary.map((item, idx) => <li key={idx}>{item}</li>)
                            ) : (
                                <>
                                    <li>Patient discussed symptoms and medical history.</li>
                                    <li>Personnel provided consultation and advised on next steps.</li>
                                    <li>Meeting concluded successfully.</li>
                                </>
                            )}
                        </ul>
                    </div>

                    <div className="end-buttons">
                        <div className="button1" onClick={viewTranscript}>
                            {loadingTranscript ? "Loading..." : "View Transcript"}
                        </div>
                        <div className="button2">✨ Scan Transcript for AI Insights</div>
                        <div className="button3" onClick={() => alert("Feedback request sent.")}>Ask for Feedback</div>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default EndCall;