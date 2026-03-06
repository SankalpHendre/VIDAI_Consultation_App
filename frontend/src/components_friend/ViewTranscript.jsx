import React from 'react'
import './EndCall.css'
import { IoIosCloseCircle } from "react-icons/io";

/**
 * Parses a formatted transcript string into speaker/dialogue pairs.
 *
 * Input line format (from backend):
 *   "Doctor (Amelia Scott): Good morning, how are you?"
 *   "Patient (Gracy Wade): I have a headache."
 *
 * Returns an array of { speaker, dialogue } objects.
 */
const parseTranscript = (text) => {
    if (!text || !text.trim()) return [];

    // Split on newlines first, then handle any leftover concatenated turns
    const rawLines = text.split('\n').filter(l => l.trim());

    const speakerRegex = /^((?:Doctor|Patient|Sales)\s*\([^)]+\))\s*:\s*(.*)/i;
    const parsed = [];

    for (const line of rawLines) {
        const match = line.trim().match(speakerRegex);
        if (match) {
            parsed.push({ speaker: match[1].trim(), dialogue: match[2].trim() });
        } else if (line.trim()) {
            // Orphan text — attach to last speaker or show as-is
            if (parsed.length > 0) {
                parsed[parsed.length - 1].dialogue += ' ' + line.trim();
            } else {
                parsed.push({ speaker: '', dialogue: line.trim() });
            }
        }
    }

    return parsed;
};

const ViewTranscript = ({ transcript, onClose }) => {
    const lines = parseTranscript(transcript);

    return (
        <div className="wrapper">
            <div className='end-container'>

                <div className="end-navbar">
                    <div style={{
                        position: 'relative', top: '15px', left: '20px',
                        fontFamily: 'Montserrat', fontWeight: '650', fontSize: '16px'
                    }}>
                        Consultation Transcript
                    </div>
                    <div className="end-cross" onClick={onClose}>
                        <IoIosCloseCircle size={25} />
                    </div>
                </div>

                <div className="transc-info">
                    {lines.length === 0 ? (
                        <div style={{
                            fontFamily: 'Nunito', fontSize: '15px', color: '#9E9E9E',
                            marginTop: '20px', textAlign: 'center'
                        }}>
                            No transcript available for this session.
                        </div>
                    ) : (
                        lines.map((line, idx) => (
                            <div key={idx} style={{ display: 'flex', marginBottom: '10px', alignItems: 'flex-start' }}>
                                <div className='t-secondary' style={{ minWidth: '130px', flexShrink: 0 }}>
                                    {line.speaker}
                                </div>
                                <div className='t-primary'>
                                    : {line.dialogue}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div style={{ height: '40px', display: 'flex', justifyContent: 'flex-end', marginRight: '15px' }}>
                    <div className="button2">✨ Scan for AI Insights</div>
                </div>

            </div>
        </div>
    );
};

export default ViewTranscript;