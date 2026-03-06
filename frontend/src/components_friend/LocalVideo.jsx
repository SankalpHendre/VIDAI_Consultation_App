import React, { useRef, useEffect } from 'react';
import './LocalVideo.css';

const getInitials = (name) => {
  if (!name || !name.trim()) return 'ME';
  // Strip common titles so "Dr. Amelia Scott" → "AS" not "DA"
  const cleaned = name.trim().replace(/^(dr|mr|mrs|ms|prof|sr|jr)\.?\s*/i, '');
  const words   = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

const LocalVideo = ({ myStream, mode = 'full', videoOn = true, myName = '' }) => {
  const videoRef = useRef(null);
  const isMini   = mode === 'mini';
  const initials = getInitials(myName);

  useEffect(() => {
    if (videoRef.current && myStream) {
      videoRef.current.srcObject = myStream;
    }
  }, [myStream]);

  return (
    <div
      className={`local-video-container ${isMini ? 'mini-local-video' : ''} ${!videoOn ? 'video-off' : ''}`}
    >
      {/* ── "You" name badge ── */}
      <div className={`video-name-container ${isMini ? 'mini-video-name' : ''}`}>
        <p>You</p>
      </div>

      {/* ── Live video (always mounted; hidden via CSS when cam is off) ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: videoOn ? 'block' : 'none' }}
      />

      {/* ── Initials avatar (shown only when camera is OFF) ── */}
      {!videoOn && (
        <div className="local-avatar-overlay">
          <div className="local-avatar-circle">
            <span>{initials}</span>
          </div>
          {!isMini && (
            <span className="local-avatar-label">You</span>
          )}
        </div>
      )}
    </div>
  );
};

export default LocalVideo;