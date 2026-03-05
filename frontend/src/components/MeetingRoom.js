import React, { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import Draggable from "react-draggable";
import { API_URL as API, WS_URL as WS } from "../config";
import "./MeetingRoom.css";

// ── Imports ──────────────────────────────────────────────────────────────────
import TopNav from "../components_friend/TopNav";
import RemoteVideo from "../components_friend/RemoteVideo";
import RightSideBar from "../components_friend/RightSideBar";
import ChatSidebar from "../components_friend/ChatSidebar";
import TransSideBar from "../components_friend/TransSideBar";
import InfoSideBar from "../components_friend/InfoSideBar";
import ApptDetails from "../components_friend/ApptDetails";
import EndCall from "../components_friend/EndCall";
// ─────────────────────────────────────────────────────────────────────────────

const COMMIT_DELAY = 250;
const SELF_PREFIX = 0x01;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 10,
};

const KNOWN_ROLES = ["doctor", "patient", "admin", "sales"];

// ── GuestPreJoin ─────────────────────────────────────────────────────────────
function GuestPreJoin({ onJoin }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr("Please enter your name."); return; }
    onJoin(trimmed);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#f1f5f9",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', Arial, sans-serif", zIndex: 9999,
    }}>
      <div style={{
        background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.10)", padding: "48px 52px",
        width: "100%", maxWidth: 400, textAlign: "center",
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%", background: "#eff6ff",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px", fontSize: 28,
        }}>🏥</div>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.4rem", fontWeight: 700, color: "#0f172a" }}>Join Consultation</h2>
        <p style={{ margin: "0 0 28px", fontSize: "0.9rem", color: "#64748b" }}>Enter your name to join the meeting room.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text" placeholder="Your full name" value={name}
            onChange={e => { setName(e.target.value); setErr(""); }} autoFocus
            style={{
              width: "100%", padding: "12px 14px", fontSize: "0.95rem",
              border: `1px solid ${err ? "#f87171" : "#cbd5e1"}`, borderRadius: 8,
              outline: "none", boxSizing: "border-box", color: "#0f172a",
              background: "#f8fafc", marginBottom: err ? 6 : 16,
            }}
          />
          {err && <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#ef4444", textAlign: "left" }}>{err}</p>}
          <button type="submit" style={{
            width: "100%", padding: "12px", fontSize: "0.95rem", fontWeight: 600,
            color: "#ffffff", background: "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "none", borderRadius: 8, cursor: "pointer",
          }}>Join Room →</button>
        </form>
      </div>
    </div>
  );
}

// ── MeetingRoom ───────────────────────────────────────────────────────────────
export default function MeetingRoom() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();

  // meeting_id from URL — could be numeric pk ("14") or UUID string
  const meetingId = searchParams.get("meeting_id");
  const token = localStorage.getItem("token");
  const navigate = useNavigate();

  const urlRole    = searchParams.get("role");
  const storedRole = localStorage.getItem("role");
  const isAuth     = !!token && KNOWN_ROLES.includes(storedRole);

  const resolvedRole = isAuth
    ? storedRole
    : (urlRole && KNOWN_ROLES.includes(urlRole) ? urlRole : "guest");

  const storedName = localStorage.getItem("full_name") || localStorage.getItem("username");
  const [guestName, setGuestName] = useState(isAuth ? "" : null);

  const myName = isAuth ? (storedName || "User") : (guestName || "Guest");
  const myRole = resolvedRole;
  const isGuest = !isAuth;

  // ── Refs ────────────────────────────────────────────────────────────────────
  const [localStream, setLocalStream]         = useState(null);
  const localStreamRef                        = useRef(null);
  const peersRef                              = useRef({});
  const [remotes, setRemotes]                 = useState([]);

  const sigWsRef    = useRef(null);
  const myIdRef     = useRef(null);
  const isMountedRef = useRef(true);
  const sttWsRef    = useRef(null);
  const audioCtxRef = useRef(null);
  const procRef     = useRef(null);
  const nodeRef     = useRef(null);

  const bufRef      = useRef("");
  const timerRef    = useRef(null);
  const latestRef   = useRef("");         // always holds latest transcript text
  const meetingIdRef = useRef(meetingId); // UUID once resolved; numeric pk as fallback

  // ── State ───────────────────────────────────────────────────────────────────
  const [micOn, setMicOn]               = useState(true);
  const [camOn, setCamOn]               = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenTrackRef                  = useRef(null);
  const [connected, setConnected]       = useState(false);
  const [sttStatus, setSttStatus]       = useState("");
  const [transcript, setTranscript]     = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [rightPanel, setRightPanel]     = useState(null);
  const [duration, setDuration]         = useState(0);

  // ── FIX: store call start time so both sides compute same-ish duration ──────
  const callStartRef = useRef(null);

  const [error, setError]               = useState("");
  const [participants, setParticipants] = useState([]);
  const [unreadChat, setUnreadChat]     = useState(0);
  const [unreadTx, setUnreadTx]         = useState(0);
  const [meetingEnded, setMeetingEnded] = useState(false);

  // ── Integrated state ────────────────────────────────────────────────────────
  const [isMini, setIsMini]         = useState(false);
  const [meetingData, setMeetingData] = useState(null);

  // ── Fetch meeting data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!meetingId) return;
    const fetchMeeting = async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API}/api/meeting/${meetingId}/`, { headers });
        if (res.ok) {
          const data = await res.json();
          setMeetingData(data);
          // If backend returned UUID meeting_id, store it so EndCall can fetch transcript
          if (data.meeting_id) {
            meetingIdRef.current = data.meeting_id;
            localStorage.setItem("current_meeting_uuid", data.meeting_id);
          }
        }
      } catch (err) { console.error("Meeting fetch failed:", err); }
    };
    fetchMeeting();
  }, [meetingId, token]);

  // ── Duration timer — starts on connect ─────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    callStartRef.current = Date.now();   // record wall-clock start
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => { latestRef.current = transcript; }, [transcript]);

  useEffect(() => {
    if (guestName === null) return;
    isMountedRef.current = true;
    _init();
    return () => { isMountedRef.current = false; _cleanup(); };
  }, [guestName]); // eslint-disable-line

  const _init = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      _openSignalling();
    } catch (err) { setError(`Media error: ${err.message}`); }
  };

  const _openSignalling = () => {
    const ws = new WebSocket(`${WS}/ws/call/${roomId}/`);
    sigWsRef.current = ws;
    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", name: myName, role: myRole }));
      _openSttWs();
    };
    ws.onmessage = async (evt) => {
      let msg; try { msg = JSON.parse(evt.data); } catch { return; }
      switch (msg.type) {
        case "assigned":
          myIdRef.current = msg.id;
          setParticipants(msg.peers || []);
          for (const peer of (msg.peers || [])) await _createPeerConnection(peer.id, peer.name, peer.role, true);
          break;
        case "peer_joined":
          setParticipants(prev => [...prev.filter(p => p.id !== msg.id), { id: msg.id, name: msg.name, role: msg.role }]);
          await _createPeerConnection(msg.id, msg.name, msg.role, false);
          break;
        case "peer_left":
          _removePeer(msg.id);
          setParticipants(prev => prev.filter(p => p.id !== msg.id));
          break;
        case "offer":  await _handleOffer(msg.from, msg.offer);   break;
        case "answer": await _handleAnswer(msg.from, msg.answer); break;
        case "ice":    await _handleIce(msg.from, msg.candidate); break;
        case "chat":
          setChatMessages(prev => [...prev, {
            text: msg.text, sender: msg.name,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }]);
          if (rightPanel !== "chat") setUnreadChat(n => n + 1);
          break;
        case "transcript_line":
          setTranscript(prev => prev ? `${prev}\n${msg.text}` : msg.text);
          if (rightPanel !== "notes") setUnreadTx(n => n + 1);
          break;
        default: break;
      }
    };
  };

  const _createPeerConnection = async (peerId, peerName, peerRole, sendOffer) => {
    if (peersRef.current[peerId]) return;
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current[peerId] = { pc, name: peerName, role: peerRole, stream: null };
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      peersRef.current[peerId].stream = stream;
      setRemotes(prev => {
        const ex = prev.find(r => r.id === peerId);
        if (ex) return prev.map(r => r.id === peerId ? { ...r, stream } : r);
        return [...prev, { id: peerId, name: peerName, role: peerRole, stream }];
      });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && sigWsRef.current?.readyState === WebSocket.OPEN)
        sigWsRef.current.send(JSON.stringify({ type: "ice", to: peerId, candidate: e.candidate }));
    };
    if (sendOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sigWsRef.current?.send(JSON.stringify({ type: "offer", to: peerId, offer }));
    }
  };

  const _handleOffer = async (fromId, offer) => {
    if (!peersRef.current[fromId]) await _createPeerConnection(fromId, "Participant", "participant", false);
    const { pc } = peersRef.current[fromId];
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sigWsRef.current?.send(JSON.stringify({ type: "answer", to: fromId, answer }));
  };

  const _handleAnswer = async (fromId, answer) => {
    const peer = peersRef.current[fromId];
    if (peer?.pc.signalingState === "have-local-offer")
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const _handleIce = async (fromId, candidate) => {
    const peer = peersRef.current[fromId];
    if (peer && candidate)
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) { }
  };

  const _removePeer = (peerId) => {
    const peer = peersRef.current[peerId];
    if (peer) { peer.pc.close(); delete peersRef.current[peerId]; }
    setRemotes(prev => prev.filter(r => r.id !== peerId));
  };

  const _openSttWs = useCallback(() => {
    if (sttWsRef.current) return;
    const ws = new WebSocket(`${WS}/ws/stt/room/?role=${myRole}&name=${encodeURIComponent(myName)}`);
    ws.binaryType = "arraybuffer";
    sttWsRef.current = ws;
    ws.onmessage = evt => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "stt_ready") { setSttStatus("live"); setTimeout(() => _startSttCapture(ws), 100); }
      if (msg.type === "transcript" && msg.is_final && msg.text) {
        const text = msg.text.trim(); if (!text) return;
        bufRef.current = bufRef.current ? `${bufRef.current} ${text}` : text;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(_flushBuffer, COMMIT_DELAY);
      }
    };
  }, [myRole, myName]); // eslint-disable-line

  const _startSttCapture = (ws) => {
    if (!localStreamRef.current) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const src  = ctx.createMediaStreamSource(localStreamRef.current);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = e => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const prefixed = new Uint8Array(1 + out.buffer.byteLength);
        prefixed[0] = SELF_PREFIX;
        prefixed.set(new Uint8Array(out.buffer), 1);
        ws.send(prefixed.buffer);
      };
      src.connect(proc); proc.connect(ctx.destination);
    } catch (err) { console.error("STT setup failed:", err); }
  };

  const _flushBuffer = useCallback(() => {
    const text = bufRef.current.trim(); bufRef.current = "";
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!text) return;
    const speakerLabel = myRole.charAt(0).toUpperCase() + myRole.slice(1);
    const line = `${speakerLabel} (${myName}): ${text}`;
    setTranscript(prev => prev ? `${prev}\n${line}` : line);
    if (rightPanel !== "notes") setUnreadTx(n => n + 1);
    if (sigWsRef.current?.readyState === WebSocket.OPEN)
      sigWsRef.current.send(JSON.stringify({ type: "transcript_line", text: line }));
    if (meetingIdRef.current && token) {
      fetch(`${API}/api/append-transcript/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meeting_id: meetingIdRef.current, line }),
      }).catch(() => { });
    }
  }, [myRole, myName, token, rightPanel]);

  const toggleMic = () => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = next);
    setMicOn(next);
  };

  const toggleCamera = () => {
    const next = !camOn;
    localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = next);
    setCamOn(next);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenTrackRef.current?.stop();
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender) sender.replaceTrack(camTrack);
        });
      }
      screenTrackRef.current = null;
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenTrack  = screenStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        });
        setIsScreenSharing(true);
        screenTrack.onended = () => {
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            Object.values(peersRef.current).forEach(({ pc }) => {
              const sender = pc.getSenders().find(s => s.track?.kind === "video");
              if (sender) sender.replaceTrack(camTrack);
            });
          }
          screenTrackRef.current = null;
          setIsScreenSharing(false);
        };
      } catch (err) {
        if (err.name !== "NotAllowedError") setError("Screen share failed: " + err.message);
      }
    }
  };

  const sendChat = (text) => {
    if (!text || sigWsRef.current?.readyState !== WebSocket.OPEN) return;
    sigWsRef.current.send(JSON.stringify({ type: "chat", text }));
    setChatMessages(prev => [...prev, {
      text, sender: myName,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  };

  // ── End call ────────────────────────────────────────────────────────────────
  const handleEndCall = async () => {
    // ── FIX: compute duration from wall-clock so it's consistent regardless
    //         of when each participant's timer happened to start ──────────────
    const finalDuration = callStartRef.current
      ? Math.round((Date.now() - callStartRef.current) / 1000)
      : duration;

    setConnected(false);       // stops duration timer
    setDuration(finalDuration);

    if (screenTrackRef.current) { screenTrackRef.current.stop(); screenTrackRef.current = null; }
    _cleanup();

    // Save transcript to backend BEFORE showing EndCall screen
    // Doctor sends empty string → backend will NOT overwrite patient's transcript (fixed in views.py)
    if (!isGuest && meetingIdRef.current && token) {
      try {
        await fetch(`${API}/api/meeting/end/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            meeting_id: meetingIdRef.current,
            speech_to_text: latestRef.current,   // empty string for doctor = no overwrite
          }),
        });
      } catch { /* ignore — meeting ended locally regardless */ }
    }

    setMeetingEnded(true);
  };

  const _cleanup = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(peersRef.current).forEach(p => p.pc.close());
    sigWsRef.current?.close();
    sttWsRef.current?.close();
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => { });
    }
  };

  const formatTranscriptForUI = (str) => {
    if (!str) return [];
    return str.split("\n").map(l => {
      const m = l.match(/^([^:]+): (.*)$/);
      return m ? { speaker: m[1], text: m[2] } : { speaker: "System", text: l };
    });
  };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (guestName === null) return <GuestPreJoin onJoin={setGuestName} />;

  // ── FIX: pass meetingId (UUID from ref if resolved, else numeric from URL)
  //         AND the local transcript so EndCall always has something to show
  //         while the backend fetch loads ────────────────────────────────────
  if (meetingEnded) {
    return (
      <EndCall
        duration={duration}
        meetingId={meetingIdRef.current || meetingId}
        transcript={latestRef.current}
      />
    );
  }

  const mainRemote = remotes[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f8f9fa" }}>
      {!isMini && <TopNav isMini={isMini} setIsMini={setIsMini} roomId={roomId} />}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        {isMini ? (
          <Draggable nodeRef={nodeRef}>
            <div ref={nodeRef} className="min-body">
              <TopNav isMini={isMini} setIsMini={setIsMini} roomId={roomId} />
              <div className="min-content">
                <RemoteVideo
                  mode="mini"
                  myStream={localStream}
                  remoteStream={mainRemote?.stream}
                  name={mainRemote?.name || (meetingData?.doctor_name ? `Dr. ${meetingData.doctor_name}` : "Waiting...")}
                  role={mainRemote?.role}
                  patientMuted={!micOn}
                  toggleVideo={toggleCamera}
                  toggleAudio={toggleMic}
                  endCall={handleEndCall}
                  isSidebarOpen={false}
                  toggleScreenShare={toggleScreenShare}
                  isScreenSharing={isScreenSharing}
                />
              </div>
            </div>
          </Draggable>
        ) : (
          <RemoteVideo
            mode="full"
            myStream={localStream}
            remoteStream={mainRemote?.stream}
            name={mainRemote?.name || (meetingData?.doctor_name ? `Dr. ${meetingData.doctor_name}` : "Waiting for partner...")}
            role={mainRemote?.role || "doctor"}
            patientMuted={!micOn}
            toggleVideo={toggleCamera}
            toggleAudio={toggleMic}
            endCall={handleEndCall}
            isSidebarOpen={!!rightPanel}
            toggleScreenShare={toggleScreenShare}
            isScreenSharing={isScreenSharing}
          />
        )}

        {rightPanel && !isMini && (
          <div style={{
            width: "300px", flexShrink: 0, height: "100%",
            borderLeft: "1px solid #ece8f4", background: "#ffffff",
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "-2px 0 12px rgba(100,80,200,0.07)",
          }}>
            {rightPanel === "chat" && (
              <ChatSidebar
                activeSidebar={rightPanel} setActiveSidebar={setRightPanel}
                messages={chatMessages} onSendMessage={sendChat} myName={myName}
              />
            )}
            {rightPanel === "notes" && (
              <TransSideBar
                activeSidebar={rightPanel} setActiveSidebar={setRightPanel}
                notes={formatTranscriptForUI(transcript)}
              />
            )}
            {rightPanel === "person" && (
              <InfoSideBar
                activeSidebar={rightPanel} setActiveSidebar={setRightPanel}
                patientData={meetingData?.patient}
              />
            )}
            {rightPanel === "alert" && (
              <ApptDetails
                activeSidebar={rightPanel} setActiveSidebar={setRightPanel}
                apptData={meetingData}
              />
            )}
          </div>
        )}

        {!rightPanel && !isMini && (
          <RightSideBar
            activeSidebar={rightPanel}
            setActiveSidebar={setRightPanel}
            unreadChat={unreadChat > 0}
          />
        )}
      </div>

      {error && (
        <div style={{
          position: "fixed", bottom: "90px", right: "20px",
          background: "#ff4444", color: "white",
          padding: "10px 20px", borderRadius: "8px", zIndex: 1000,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}