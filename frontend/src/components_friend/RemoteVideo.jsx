import React, { useRef, useEffect, useState } from 'react';
import './RemoteVideo.css';
import CallOptions from './CallOptions';
import LocalVideo  from './LocalVideo';
import { FaMicrophoneAlt, FaMicrophoneAltSlash } from 'react-icons/fa';

/*
  PROP CONTRACT
  ─────────────────────────────────────────────────────────────────────────────
  patientMuted  (boolean) — LOCAL user's mic is off
                            → forwarded to CallOptions (YOUR mic button icon)

  remoteMuted   (boolean) — REMOTE participant's mic is off
                            → drives the 🎤 / 🔇 badge on the remote tile

  remoteCamOff  (boolean) — REMOTE participant's camera is off
                            → hides the video element and shows initials avatar

  myName        (string)  — LOCAL user's name passed to LocalVideo so it can
                            show YOUR initials when YOUR camera is off

  name          (string)  — REMOTE participant's display name
*/

const getInitials = (name) => {
  if (!name || !name.trim()) return '??';
  const cleaned = name.trim().replace(/^(dr|mr|mrs|ms|prof|sr|jr)\.?\s*/i, '');
  const words   = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

const RemoteVideo = ({
  mode = 'full',
  myStream,
  remoteStream,
  patientMuted,   // LOCAL  mic state → CallOptions only
  remoteMuted,    // REMOTE mic state → badge on remote tile
  remoteCamOff,   // REMOTE cam state → avatar overlay
  toggleVideo,
  toggleAudio,
  endCall,
  isSidebarOpen,
  name,           // REMOTE participant display name
  role,
  toggleScreenShare,
  isScreenSharing,
  myName,         // LOCAL user name → passed to LocalVideo
}) => {
  const [videoOn, setVideoOn] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const videoRef = useRef(null);
  const isMini   = mode === 'mini';
  const initials = getInitials(name);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Call duration — starts counting when remote stream arrives
  useEffect(() => {
    let interval;
    if (remoteStream) {
      interval = setInterval(() => setSeconds(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [remoteStream]);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  // Show avatar when:
  //   • No remote stream yet (waiting / calling state)
  //   • Remote stream exists but they turned their camera off
  const showAvatar = !remoteStream || remoteCamOff;

  return (
    <div className={`container ${isMini ? 'mini-container' : ''} ${isSidebarOpen ? 'sidebar-active' : ''}`}>

      {/* ── Remote live video ──────────────────────────────────────────────
          Keep the element mounted when cam is off so the MediaStream stays
          attached and can resume instantly without renegotiation.           */}
      {remoteStream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="video-player"
          style={{ display: remoteCamOff ? 'none' : 'block' }}
        />
      )}

      {/* ── Avatar / waiting frame ─────────────────────────────────────────
          Reuses the existing .frame and .name CSS classes so it matches the
          calling-screen style exactly. Extra labels are added via new classes
          .cam-off-badge / .cam-off-name / .cam-off-pill defined in the CSS.  */}
      <div
        className={`frame ${isMini ? 'mini-frame' : ''}`}
        style={{ display: showAvatar ? 'flex' : 'none' }}
      >
        {/* Initials circle — same .name class as the calling screen */}
        <div className={`name ${isMini ? 'mini-name' : ''}`}>
          <div style={{
            fontFamily  : 'Montserrat, sans-serif',
            fontWeight  : 800,
            fontSize    : isMini ? '28px' : '48px',
            color       : '#896AE3',
          }}>
            {initials}
          </div>
        </div>

        {/* ── Label below the circle ── */}
        {remoteStream && remoteCamOff ? (
          /* Camera-off state — show name + "Camera Off" pill */
          <div className="cam-off-badge">
            <div className={`cam-off-name ${isMini ? 'mini-cam-off-name' : ''}`}>
              {/* {name || 'Participant'} */}
            </div>

          </div>
        ) : (
          /* No stream yet — simple "Calling…" text matching original UI */
          <div style={{ fontSize: isMini ? '12px' : '14px', marginTop: '24px', color: '#64748b' }}>
            Calling...
          </div>
        )}
      </div>

      {/* ── Call controls (YOUR own buttons) ──────────────────────────── */}
      <CallOptions
        videoOn={videoOn}
        setVideoOn={setVideoOn}
        toggleVideo={toggleVideo}
        toggleAudio={toggleAudio}
        endCall={endCall}
        role={role}
        toggleScreenShare={toggleScreenShare}
        isScreenSharing={isScreenSharing}
        patientMuted={patientMuted}
      />

      {/* ── Call duration timer ───────────────────────────────────────── */}
      <div className="time">
        <div className="time-align">
          <div style={{ fontSize: '12px', fontWeight: '500' }}>{formatTime(seconds)}</div>
        </div>
      </div>

      {/* ── Remote participant name tag (top-left) ─────────────────────── */}
      <div className="info">
        <div style={{ fontSize: '11px', fontWeight: '500' }}>{name}</div>
      </div>

      {/* ── Remote mic badge (top-right) ───────────────────────────────────
          Driven by `remoteMuted` (NOT patientMuted).
          🎤 = mic on  |  🔇 = mic muted                                   */}
      <div className={`loc-mic ${isMini ? 'mini-loc-mic' : ''}`}>
        {remoteMuted
          ? <FaMicrophoneAltSlash color="red" />
          : <FaMicrophoneAlt />
        }
      </div>

      {/* ── Local user's PiP ───────────────────────────────────────────────
          myName is passed so LocalVideo shows YOUR initials if YOUR cam is
          off. videoOn is the LOCAL toggle state (managed inside this component
          via CallOptions → setVideoOn).                                    */}
      <LocalVideo
        myStream={myStream}
        mode={mode}
        videoOn={videoOn}
        myName={myName}
      />

    </div>
  );
};

export default RemoteVideo;