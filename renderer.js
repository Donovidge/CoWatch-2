// renderer.js (drop-in replacement)

// Helpers
const $ = (sel) => document.querySelector(sel);

// Elements
const fileInput    = $('#fileInput');
const localVideo   = $('#localVideo');
const remoteVideo  = $('#remoteVideo');
const btnStart     = $('#btnStartPublic');
const statusEl     = $('#publicStatus');
const linkEl       = $('#publicLink');
const btnCopy      = $('#btnCopyLink');

// Basic state
let ws = null;
let roomId = null;
let pin = null;
let hasStarted = false;

// ---- Utilities ----
function genId(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function makeGuestUrl(roomId, pin) {
  // Works for both http://localhost and packaged Electron http servers
  const base = window.location.origin;
  return `${base}/guest.html?room=${encodeURIComponent(roomId)}&pin=${encodeURIComponent(pin)}`;
}
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}

// ---- WebSocket wiring ----
function ensureSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;

  const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(WS_URL);

  ws.onopen = () => setStatus('Connected. You can share the link now.');
  ws.onclose = () => setStatus('Disconnected from server.');
  ws.onerror = () => setStatus('WebSocket error. Is the server running?');

  ws.onmessage = (ev) => {
    // (Optional) handle any future host-targeted messages if you add them
    // For now, guests react to host messages defined in guest.html.
  };

  return ws;
}

// ---- Button: Start public server ----
function onStartPublicClick() {
  if (hasStarted) return;      // avoid double handling
  hasStarted = true;

  // Generate or reuse identifiers
  roomId = roomId || genId(4) + '-' + genId(4);
  pin    = pin    || ('' + Math.floor(100000 + Math.random() * 900000)); // 6-digit

  // Show the link immediately (guest page connects on its own)
  const url = makeGuestUrl(roomId, pin);
  linkEl.value = url;
  btnCopy.disabled = false;

  // Establish WS so guests can join & receive playback commands
  ensureSocket();

  // Announce to server that we're the host / creating the room
  ws.addEventListener('open', () => {
    try {
      // THIS IS THE FIX: Changed type from 'host' to 'create'
      ws.send(JSON.stringify({ type: 'create', roomId, pin, name: 'host' }));
      setStatus(`Room ${roomId} is ready. Share the link.`);
    } catch {
      // no-op
    }
  }, { once: true });
}

// ---- Button: Copy link ----
function onCopyLink() {
  if (!linkEl.value) return;
  navigator.clipboard.writeText(linkEl.value).then(
    () => setStatus('Link copied to clipboard.'),
    () => setStatus('Could not copy link. You can copy it manually.')
  );
}

// ---- File picker -> local preview ----
if (fileInput && localVideo) {
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    localVideo.src = url;
    // Autoplay may be blocked; user can press play
    try { await localVideo.play(); } catch {}
    setStatus('Local video loaded.');
    // If you later add an /upload route, you can POST the file here, then
    // send {type:'loadVideo', url:'/uploads/xyz.mp4'} via ws to guests.
  });
}

// ---- Play/Pause/Seek sync (host -> guests) ----
// When you’re ready to sync playback, attach these listeners:
function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ roomId, pin, ...msg }));
}
if (localVideo) {
  localVideo.addEventListener('play',  () => send({ type: 'play'  }));
  localVideo.addEventListener('pause', () => send({ type: 'pause' }));
  localVideo.addEventListener('seeked',() => send({ type: 'seek', time: localVideo.currentTime }));
}

// ---- One-time bindings (no double binding) ----
if (btnStart) btnStart.addEventListener('click', onStartPublicClick, { once: true });
if (btnCopy)  btnCopy.addEventListener('click', onCopyLink);