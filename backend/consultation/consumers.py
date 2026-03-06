import asyncio
import datetime
import json
import os
import uuid
from urllib.parse import unquote_plus

import websockets
from channels.generic.websocket import AsyncWebsocketConsumer

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "241891d132965abc6b1488661f56229bc0d70f47")

try:
    _WS_MAJOR = int(websockets.__version__.split(".")[0])
except Exception:
    _WS_MAJOR = 10

_HEADERS_KWARG = "additional_headers" if _WS_MAJOR >= 14 else "extra_headers"
print(f"(INFO) websockets {websockets.__version__}  ->  header kwarg = '{_HEADERS_KWARG}'")

DEEPGRAM_URI_GENERAL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&punctuate=true"
    "&interim_results=true"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&channels=1"
    "&smart_format=true"
    "&endpointing=200"
)

DEEPGRAM_URI   = DEEPGRAM_URI_GENERAL
DOCTOR_PREFIX  = 0x01
PATIENT_PREFIX = 0x02
KEEPALIVE_MSG  = json.dumps({"type": "KeepAlive"})

# In-memory room registry  { room_name: { peer_id: { name, role, channel } } }
_room_peers: dict = {}


# =============================================================================
# 1. CallConsumer  —  WebRTC + chat + transcript + MIC STATUS + CAM STATUS
# =============================================================================

class CallConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.room_name       = self.scope["url_route"]["kwargs"]["room"]
        self.room_group_name = f"call_{self.room_name}"
        self.peer_id         = str(uuid.uuid4())[:8]
        self.peer_name       = "Participant"
        self.peer_role       = "participant"

        _room_peers.setdefault(self.room_name, {})
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        print(f"OK [Call] peer={self.peer_id} connected  room={self.room_name}")

    async def disconnect(self, close_code):
        _room_peers.get(self.room_name, {}).pop(self.peer_id, None)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type"   : "relay_message",
                "payload": {"type": "peer_left", "id": self.peer_id},
                "exclude": self.channel_name,
            },
        )
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        print(f"ERR [Call] peer={self.peer_id} left  room={self.room_name}  code={close_code}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception:
            return

        msg_type = data.get("type")

        # ── join ──────────────────────────────────────────────────────────────
        if msg_type == "join":
            self.peer_name = data.get("name", "Participant")
            self.peer_role = data.get("role", "participant")
            room = _room_peers.setdefault(self.room_name, {})
            existing_peers = [
                {"id": pid, "name": info["name"], "role": info["role"]}
                for pid, info in room.items()
            ]
            room[self.peer_id] = {
                "name"   : self.peer_name,
                "role"   : self.peer_role,
                "channel": self.channel_name,
            }
            await self.send(json.dumps({
                "type" : "assigned",
                "id"   : self.peer_id,
                "peers": existing_peers,
            }))
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type"   : "relay_message",
                    "payload": {
                        "type": "peer_joined",
                        "id"  : self.peer_id,
                        "name": self.peer_name,
                        "role": self.peer_role,
                    },
                    "exclude": self.channel_name,
                },
            )
            print(
                f"INFO [Call] {self.peer_name} ({self.peer_role}) joined "
                f"room={self.room_name}  peers={len(room)}"
            )
            return

        # ── WebRTC signalling ─────────────────────────────────────────────────
        if msg_type in ("offer", "answer", "ice"):
            to_id  = data.get("to")
            target = _room_peers.get(self.room_name, {}).get(to_id)
            if not target:
                return
            fwd = {**data, "from": self.peer_id}
            fwd.pop("to", None)
            await self.channel_layer.group_send(
                self.room_group_name,
                {"type": "relay_to_channel", "payload": fwd, "target_channel": target["channel"]},
            )
            return

        # ── in-room chat ──────────────────────────────────────────────────────
        if msg_type == "chat":
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type"   : "relay_message",
                    "payload": {
                        "type": "chat",
                        "from": self.peer_id,
                        "name": self.peer_name,
                        "role": self.peer_role,
                        "text": str(data.get("text", ""))[:500],
                        "ts"  : datetime.datetime.utcnow().isoformat() + "Z",
                    },
                    "exclude": self.channel_name,
                },
            )
            return

        # ── real-time transcript broadcast ────────────────────────────────────
        if msg_type == "transcript_line":
            text = str(data.get("text", "")).strip()
            if not text:
                return
            print(f"LOG [Transcript] {self.peer_name} ({self.peer_role}) room={self.room_name}: {text[:80]}")
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type"   : "relay_message",
                    "payload": {
                        "type": "transcript_line",
                        "text": text,
                        "from": self.peer_id,
                        "name": self.peer_name,
                        "role": self.peer_role,
                    },
                    "exclude": self.channel_name,
                },
            )
            return

        # ── MIC STATUS ────────────────────────────────────────────────────────
        # Sent when a participant mutes/unmutes their microphone.
        # Relayed to ALL peers (including sender) so the frontend can filter
        # its own echo with  msg.from !== myIdRef.current.
        if msg_type == "mic_status":
            muted = bool(data.get("muted", False))
            print(f"LOG [MicStatus] {self.peer_name} ({self.peer_role}) muted={muted}  room={self.room_name}")
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type"   : "relay_message",
                    "payload": {
                        "type" : "mic_status",
                        "from" : self.peer_id,
                        "name" : self.peer_name,
                        "role" : self.peer_role,
                        "muted": muted,
                    },
                    "exclude": None,   # send to all — frontend filters own echo
                },
            )
            return

        # ── CAMERA STATUS ─────────────────────────────────────────────────────
        # Sent when a participant turns their camera on or off.
        # The remote peer receives this and toggles the initials avatar overlay
        # instead of showing a black screen.
        #
        # Payload sent by frontend:
        #   { "type": "cam_status", "cam_off": true|false, "name": "...", "role": "..." }
        #
        # Broadcast received by remote peers:
        #   { "type": "cam_status", "from": "<peer_id>", "cam_off": true|false,
        #     "name": "...", "role": "..." }
        if msg_type == "cam_status":
            cam_off = bool(data.get("cam_off", False))
            print(f"LOG [CamStatus] {self.peer_name} ({self.peer_role}) cam_off={cam_off}  room={self.room_name}")
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type"   : "relay_message",
                    "payload": {
                        "type"   : "cam_status",
                        "from"   : self.peer_id,
                        "name"   : self.peer_name,
                        "role"   : self.peer_role,
                        "cam_off": cam_off,
                    },
                    "exclude": None,   # send to all — frontend filters own echo
                },
            )
            return

    async def relay_message(self, event):
        if event.get("exclude") and self.channel_name == event["exclude"]:
            return
        await self.send(text_data=json.dumps(event["payload"]))

    async def relay_to_channel(self, event):
        if self.channel_name != event["target_channel"]:
            return
        await self.send(text_data=json.dumps(event["payload"]))


# =============================================================================
# 2. _BaseSTTConsumer
# =============================================================================

class _BaseSTTConsumer(AsyncWebsocketConsumer):
    LABEL_A = "Speaker1"
    LABEL_B = "Speaker2"
    LOG_TAG  = "STT"

    async def connect(self):
        await self.accept()
        self.dg_a = self.dg_b = None
        self.buf_a = []; self.buf_b = []
        self.dg_ready = False
        self._tasks   = []
        self._closing = False
        self._tasks.append(asyncio.ensure_future(self._init_deepgram()))

    async def disconnect(self, close_code):
        self._closing = True
        for t in self._tasks:
            if not t.done():
                t.cancel()
                try:    await t
                except asyncio.CancelledError: pass
        for ws in (self.dg_a, self.dg_b):
            if ws:
                try:    await ws.close()
                except Exception: pass

    async def receive(self, text_data=None, bytes_data=None):
        if not bytes_data or len(bytes_data) < 2:
            return
        prefix = bytes_data[0]; audio = bytes_data[1:]
        if prefix == 0x01:
            if self.dg_ready and self.dg_a:
                try:    await self.dg_a.send(audio)
                except Exception: pass
            elif len(self.buf_a) < 120:
                self.buf_a.append(audio)
        elif prefix == 0x02:
            if self.dg_ready and self.dg_b:
                try:    await self.dg_b.send(audio)
                except Exception: pass
            elif len(self.buf_b) < 120:
                self.buf_b.append(audio)

    async def _open_deepgram(self, uri=None):
        if uri is None: uri = DEEPGRAM_URI
        auth = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
        for kwarg in (_HEADERS_KWARG, "additional_headers", "extra_headers"):
            try:
                return await asyncio.wait_for(
                    websockets.connect(uri, **{kwarg: auth}, ping_interval=None, close_timeout=2),
                    timeout=15.0,
                )
            except TypeError: continue
            except asyncio.TimeoutError: raise TimeoutError(f"Deepgram timed out ({kwarg})")
            except Exception as exc: raise exc
        raise RuntimeError("No compatible websockets header kwarg")

    async def _keepalive_loop(self, label):
        while not self._closing:
            await asyncio.sleep(5)
            ws = self.dg_a if label == self.LABEL_A else self.dg_b
            if ws:
                try:    await ws.send(KEEPALIVE_MSG)
                except Exception: pass

    async def _init_deepgram(self):
        try:
            self.dg_a = await asyncio.wait_for(self._open_deepgram(), timeout=20.0)
            self.dg_b = await asyncio.wait_for(self._open_deepgram(), timeout=20.0)
            self.dg_ready = True
            for chunk in self.buf_a:
                try: await self.dg_a.send(chunk)
                except Exception: break
            self.buf_a.clear()
            for chunk in self.buf_b:
                try: await self.dg_b.send(chunk)
                except Exception: break
            self.buf_b.clear()
            await self.send(json.dumps({"type": "stt_ready"}))
            self._tasks += [
                asyncio.ensure_future(self._keepalive_loop(self.LABEL_A)),
                asyncio.ensure_future(self._keepalive_loop(self.LABEL_B)),
            ]
            await asyncio.gather(self._relay_loop(self.LABEL_A), self._relay_loop(self.LABEL_B))
        except asyncio.CancelledError: pass
        except Exception as exc:
            try: await self.send(json.dumps({"type": "stt_error", "message": str(exc)}))
            except Exception: pass

    async def _relay_loop(self, label):
        while not self._closing:
            ws = self.dg_a if label == self.LABEL_A else self.dg_b
            if not ws: await asyncio.sleep(0.5); continue
            try:
                async for raw in ws:
                    if self._closing: break
                    try: data = json.loads(raw)
                    except json.JSONDecodeError: continue
                    if data.get("type") != "Results": continue
                    alts = data.get("channel", {}).get("alternatives", [])
                    if not alts: continue
                    text = alts[0].get("transcript", "").strip()
                    is_final = data.get("is_final", False)
                    if text:
                        await self.send(json.dumps({"type": "transcript", "text": text, "is_final": is_final, "speaker": label}))
                if self._closing: break
                raise ConnectionResetError("stream closed")
            except asyncio.CancelledError: return
            except Exception as exc:
                if self._closing: break
                await asyncio.sleep(1)
                try:
                    new_ws = await asyncio.wait_for(self._open_deepgram(), timeout=20.0)
                    if label == self.LABEL_A: self.dg_a = new_ws
                    else: self.dg_b = new_ws
                except Exception: await asyncio.sleep(3)


class STTConsumer(_BaseSTTConsumer):
    LABEL_A = "Doctor";  LABEL_B = "Patient"; LOG_TAG = "STT"

class STTConsumerSales(_BaseSTTConsumer):
    LABEL_A = "Agent";   LABEL_B = "Client";  LOG_TAG = "STT-Sales"

class STTConsumerAdmin(_BaseSTTConsumer):
    LABEL_A = "Admin";   LABEL_B = "Participant"; LOG_TAG = "STT-Admin"


# =============================================================================
# 6. STTConsumerRoom  —  one Deepgram connection per participant tab
# =============================================================================

class STTConsumerRoom(AsyncWebsocketConsumer):

    async def connect(self):
        qs_raw = self.scope.get("query_string", b"").decode()
        qs = {}
        for part in qs_raw.split("&"):
            if "=" in part:
                k, v = part.split("=", 1)
                qs[k] = unquote_plus(v)
        role       = qs.get("role", "participant").strip()
        name       = qs.get("name", "").strip()
        self.label = f"{role.capitalize()} ({name})" if name else role.capitalize()
        self.log   = f"STT-Room[{role}]"
        self.deepgram_uri = DEEPGRAM_URI_GENERAL

        await self.accept()
        self.dg = None; self.buf = []; self.dg_ready = False
        self._tasks = []; self._closing = False
        self._tasks.append(asyncio.ensure_future(self._init()))

    async def disconnect(self, close_code):
        self._closing = True
        for t in self._tasks:
            if not t.done():
                t.cancel()
                try:    await t
                except asyncio.CancelledError: pass
        if self.dg:
            try:    await self.dg.close()
            except Exception: pass

    async def receive(self, text_data=None, bytes_data=None):
        if not bytes_data or len(bytes_data) < 2: return
        audio = bytes_data[1:]
        if self.dg_ready and self.dg:
            try:    await self.dg.send(audio)
            except Exception: pass
        elif len(self.buf) < 200:
            self.buf.append(audio)

    async def _open_deepgram(self):
        auth = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
        for kwarg in (_HEADERS_KWARG, "additional_headers", "extra_headers"):
            try:
                return await asyncio.wait_for(
                    websockets.connect(self.deepgram_uri, **{kwarg: auth}, ping_interval=None, close_timeout=2),
                    timeout=15.0,
                )
            except TypeError: continue
            except asyncio.TimeoutError: raise TimeoutError("Deepgram timed out")
            except Exception as exc: raise exc
        raise RuntimeError("No compatible websockets header kwarg")

    async def _keepalive_loop(self):
        while not self._closing:
            await asyncio.sleep(5)
            if self.dg:
                try:    await self.dg.send(KEEPALIVE_MSG)
                except Exception: pass

    async def _init(self):
        try:
            try:
                self.dg = await asyncio.wait_for(self._open_deepgram(), timeout=20.0)
            except Exception as e:
                await self.send(json.dumps({"type": "stt_error", "message": str(e)}))
                return
            self.dg_ready = True
            for chunk in self.buf:
                try: await self.dg.send(chunk)
                except Exception: break
            self.buf.clear()
            await self.send(json.dumps({"type": "stt_ready"}))
            self._tasks.append(asyncio.ensure_future(self._keepalive_loop()))
            await self._relay_loop()
        except asyncio.CancelledError: pass
        except Exception as exc:
            try: await self.send(json.dumps({"type": "stt_error", "message": str(exc)}))
            except Exception: pass

    async def _relay_loop(self):
        while not self._closing:
            if not self.dg: await asyncio.sleep(0.5); continue
            try:
                async for raw in self.dg:
                    if self._closing: break
                    try: data = json.loads(raw)
                    except json.JSONDecodeError: continue
                    if data.get("type") != "Results": continue
                    alts = data.get("channel", {}).get("alternatives", [])
                    if not alts: continue
                    text = alts[0].get("transcript", "").strip()
                    is_final = data.get("is_final", False)
                    if text:
                        await self.send(json.dumps({"type": "transcript", "text": text, "is_final": is_final, "speaker": self.label}))
                if self._closing: break
                raise ConnectionResetError("stream closed")
            except asyncio.CancelledError: return
            except Exception as exc:
                if self._closing: break
                await asyncio.sleep(1)
                try:
                    self.dg = await asyncio.wait_for(self._open_deepgram(), timeout=20.0)
                except Exception: await asyncio.sleep(3)