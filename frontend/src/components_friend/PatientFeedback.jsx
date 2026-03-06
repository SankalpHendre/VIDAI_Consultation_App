import React, { useState } from "react";
import './EndCall.css'
import { IoIosCloseCircle } from "react-icons/io";
import { MdCallEnd } from "react-icons/md";
import { useNavigate } from 'react-router-dom';

const PatientFeedback = ({ duration, summary, onClose }) => {
    const [rating, setRating] = useState(0);
    const [clarity, setClarity] = useState("");
    const [feedback, setFeedback] = useState("");
    const navigate = useNavigate();

    const fmt = s =>
        `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    const handleClose = () => {
        if (onClose) onClose();
        else navigate("/patient", { replace: true });
    };

    // Goes to SubmitFeedback page — route must be registered as /thanks
    const handleSubmit = () => {
        navigate('/thanks');
    };

    return (
        <div className="wrapper">
            <div className="patient-f-container">

                {/* X button */}
                <div className="end-navbar" style={{ position: 'relative' }}>
                    <div
                        className="patient-cross"
                        onClick={handleClose}
                        style={{ position: 'absolute', top: '10px', right: '14px', left: 'unset' }}
                    >
                        <IoIosCloseCircle size={25} />
                    </div>
                </div>

                <div className="end-info">

                    {/* Call ended header */}
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

                    {/* AI Summary */}
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

                    {/* Feedback form */}
                    <div className="patient-rating" style={{ height: 'auto', marginTop: '12px' }}>

                        {/* Star rating */}
                        <div style={{ fontFamily: 'Inter', fontWeight: '400', fontSize: '14px', marginBottom: '8px' }}>
                            How satisfied are you with your consultation today?
                        </div>
                        <div className="rating" style={{ marginBottom: '14px' }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                                <span
                                    key={star}
                                    className={`star ${star <= rating ? "active" : ""}`}
                                    onClick={() => setRating(star)}
                                >
                                    ★
                                </span>
                            ))}
                        </div>

                        {/* Clarity radio */}
                        <div style={{ fontFamily: 'Inter', fontWeight: '400', fontSize: '14px', marginBottom: '8px' }}>
                            Did the doctor address your concerns clearly?
                        </div>
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '14px' }}>
                            {["Yes completely", "Partially", "No"].map((option) => (
                                <label
                                    key={option}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'Inter', fontSize: '13px', cursor: 'pointer' }}
                                >
                                    <input
                                        type="radio"
                                        name="clarity"
                                        value={option}
                                        checked={clarity === option}
                                        onChange={() => setClarity(option)}
                                        style={{ accentColor: '#D73B3B' }}
                                    />
                                    {option}
                                </label>
                            ))}
                        </div>

                        {/* Optional feedback */}
                        <div style={{ fontFamily: 'Inter', fontWeight: '400', fontSize: '14px', marginBottom: '6px' }}>
                            Would you like to share additional feedback?{' '}
                            <span style={{ color: '#9E9E9E' }}>(Optional)</span>
                        </div>
                        <textarea
                            className='text-area'
                            placeholder='Share your experience or suggestions...'
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                            style={{ resize: 'none', padding: '8px', fontFamily: 'Inter', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
                        />

                        {/* Submit */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                            <div className='button3' onClick={handleSubmit}>
                                Submit Feedback
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};

export default PatientFeedback;