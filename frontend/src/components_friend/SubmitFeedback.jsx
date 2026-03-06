import React from 'react'
import './EndCall.css'
import { TiTick } from "react-icons/ti";
import { useNavigate } from 'react-router-dom';

const SubmitFeedback = () => {
    const navigate = useNavigate();

    const goHome = () => {
        const role = localStorage.getItem("role");
        if (role === "doctor") navigate("/doctor", { replace: true });
        else if (role === "patient") navigate("/patient", { replace: true });
        else navigate("/", { replace: true });
    };

    return (
        <div className='wrapper'>
            <div className='thanks-container'>

                {/* Green tick circle */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: '18px'
                }}>
                    <div style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        background: '#EDF8EF',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}>
                        <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: '#22C55E',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}>
                            <TiTick size={24} color='white' />
                        </div>
                    </div>
                </div>

                {/* Heading */}
                <div style={{
                    fontFamily: 'Inter',
                    fontWeight: '600',
                    fontSize: '17px',
                    color: '#1a1a1a',
                    textAlign: 'center',
                    marginBottom: '14px',
                }}>
                    Thanks for Submitting Feedback
                </div>

                {/* Body text */}
                <div style={{
                    fontFamily: 'Inter',
                    fontWeight: '400',
                    fontSize: '14px',
                    color: '#646464',
                    textAlign: 'center',
                    lineHeight: '1.6',
                    marginBottom: '6px',
                }}>
                    Your consultation summary and records have been saved to your health
                    portal. You can review them anytime.
                </div>
                <div style={{
                    fontFamily: 'Inter',
                    fontWeight: '400',
                    fontSize: '14px',
                    color: '#646464',
                    textAlign: 'center',
                    marginBottom: '4px',
                }}>
                    Your response helps us improve your care experience.
                </div>

                {/* Buttons */}
                <div className="thanks-buttons">
                    <div
                        className="thanks-button1"
                        onClick={goHome}
                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter', fontSize: '14px', fontWeight: '500' }}
                    >
                        Return to Dashboard
                    </div>
                    <div
                        className="thanks-button2"
                        onClick={goHome}
                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter', fontSize: '14px', fontWeight: '500' }}
                    >
                        View Consultation Summary
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SubmitFeedback;