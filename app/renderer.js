// app/renderer.js

// --- Helper & State ---
const $ = (sel) => document.querySelector(sel);
const state = {
  roomId: null,
  pin: null,
  name: 'User',
  isHost: false,
  publicUrl: null
};

// --- UI Elements ---
const accessSection = $('#access');
const roomSection = $('#room');
const createRoomIdInput = $('#createRoomId');
const createPinInput = $('#createPin');
const roomSelect = $('#roomSelect');
const joinPinInput = $('#joinPin');
const usernameInput = $('#username');
const chatLog = $('#chatLog');
const chatInput = $('#chatInput');
const videoPlayer = $('#video');
const remoteVideoPlayer = $('#remoteVideo');
const tunnelUrlA = $('#tunnelUrl');
let ws = null;

// --- Core Functions ---
function showView(view) {
  accessSection.classList.toggle('hidden', view !== 'access');
  roomSection.classList.toggle('hidden', view !== 'room');
}

function send(payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function logChatMessage(name, message) {
  const div = document.createElement('div');
  div.innerHTML = `<strong></strong>: <span></span>`;
  div.querySelector('strong').textContent = name;
  div.querySelector('span').textContent = message;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// --- WebSocket Logic ---
function setupWebSocket() {
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const type = state.isHost ? 'create' : 'join';
    send({ type, roomId: state.roomId, pin: state.pin, name: state.name });
  };

  ws.onclose = () => {
    showView('access');
    alert('Disconnected from room.');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    switch (msg.type) {
      case 'created':
      case 'joined':
        showView('room');
        $('#roomLabel').textContent = msg.roomId;
        $('#inviteRow').classList.remove('hidden'); // Show the invite button
        break;
      case 'error':
        alert(`Error: ${msg.error}`);
        if(ws) ws.close();
        break;
      case 'peer-join':
        logChatMessage('System', `${msg.name} has joined the room.`);
        break;
      case 'peer-leave':
        logChatMessage('System', `${msg.name} has left the room.`);
        break;
      case 'chat':
        logChatMessage(msg.name, msg.message);
        break;
      case 'loadVideo':
        videoPlayer.src = msg.url;
        break;
      case 'play':
        videoPlayer.play();
        break;
      case 'pause':
        videoPlayer.pause();
        break;
      case 'seek':
        videoPlayer.currentTime = msg.time;
        break;
    }
  };
}

// --- Video Controls ---
$('#btnPlay')?.addEventListener('click', () => { videoPlayer.play(); send({ type: 'play' }); });
$('#btnPause')?.addEventListener('click', () => { videoPlayer.pause(); send({ type: 'pause' }); });
$('#btnSync')?.addEventListener('click', () => { send({ type: 'seek', time: videoPlayer.currentTime }); });

videoPlayer.addEventListener('timeupdate', () => { send({ type: 'seek', time: videoPlayer.currentTime }); });

// --- Chat ---
$('#btnSend')?.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (msg) {
    send({ type: 'chat', message: msg });
    chatInput.value = '';
  }
});

// --- Room Creation/Join ---
$('#btnCreate')?.addEventListener('click', () => {
  state.roomId = createRoomIdInput.value.trim();
  state.pin = createPinInput.value.trim();
  state.isHost = true;
  state.name = usernameInput.value.trim() || 'Host';
  if (state.roomId && state.pin) setupWebSocket();
});

$('#btnJoin')?.addEventListener('click', () => {
  state.roomId = roomSelect.value;
  state.pin = joinPinInput.value.trim();
  state.isHost = false;
  state.name = usernameInput.value.trim() || 'Guest';
  if (state.roomId && state.pin) setupWebSocket();
});

$('#btnRefresh')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/rooms');
    const { rooms } = await res.json();
    roomSelect.innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  } catch {
    alert('Could not fetch rooms.');
  }
});

$('#btnLeave')?.addEventListener('click', () => {
  if (ws) ws.close();
  state.roomId = null;
  state.pin = null;
  state.publicUrl = null;
  tunnelUrlA.textContent = '';
  showView('access');
});

// --- Video Upload ---
$('#btnUpload')?.addEventListener('click', async () => {
  const file = $('#filePicker')?.files[0];
  if (!file) return alert('Please select a video file first.');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const { ok, url, error } = await res.json();
    if (ok && url) {
      videoPlayer.src = url;
      send({ type: 'loadVideo', url });
      $('#videoUrlWrap').textContent = `Shared: ${file.name}`;
    } else {
      throw new Error(error || 'Upload failed');
    }
  } catch (e) {
    alert('Upload failed.');
    console.error(e);
  }
});

// --- Electron-Specific Tunnel and Invite Logic ---

function makeInviteUrl() {
  const baseUrl = state.publicUrl || location.origin;
  return `${baseUrl}/guest/guest.html?room=${encodeURIComponent(state.roomId)}&pin=${encodeURIComponent(state.pin)}`;
}

$('#startLocalBtn')?.addEventListener('click', async () => {
  try {
    $('#startLocalBtn').disabled = true;
    state.publicUrl = await window.electronAPI.startTunnel({ provider: 'lt' });
    if (state.publicUrl) {
      tunnelUrlA.textContent = state.publicUrl;
      tunnelUrlA.href = state.publicUrl;
    } else {
      throw new Error('Tunnel URL was not returned.');
    }
  } catch (e) {
    alert(`Failed to start public link:\n\n${e.message}`);
    console.error(e);
  } finally {
    $('#startLocalBtn').disabled = false;
  }
});

$('#stopLinkBtn')?.addEventListener('click', async () => {
  try {
    $('#stopLinkBtn').disabled = true;
    await window.electronAPI.stopTunnel();
    state.publicUrl = null;
    tunnelUrlA.textContent = 'Link stopped.';
    tunnelUrlA.removeAttribute('href');
  } catch(e) {
    alert('Failed to stop link');
  } finally {
    $('#stopLinkBtn').disabled = false;
  }
});

$('#btnCopyInvite')?.addEventListener('click', () => {
  if (!state.roomId || !state.pin) return;
  const inviteLink = makeInviteUrl();
  window.electronAPI.copyToClipboard(inviteLink);
  const indicator = $('#inviteCopied');
  indicator.textContent = 'Copied!';
  setTimeout(() => indicator.textContent = '', 2000);
});

// --- Screenshare Logic (Integrated) ---
document.addEventListener('DOMContentLoaded', () => {
  const btnPickSource = $('#btnPickSource');
  const btnStartShare = $('#btnStartShare');
  const btnStartCropped = $('#btnStartCropped');
  const btnStopShare = $('#btnStopShare');
  const sharePreview = $('#sharePreview');
  const cropCanvas = $('#cropCanvas');
  const cropRect = $('#cropRect');
  let localStream = null;
  let peer = null;
  let cropX = 0, cropY = 0, cropWidth = 0, cropHeight = 0;

  async function populateScreenSources() {
    alert('Button clicked! Checking electronAPI...');
    if (!window.electronAPI) {
      alert('Error: electronAPI is not available. Check preload.js setup.');
      return;
    }
    try {
      const sources = await window.electronAPI.listScreenSources();
      alert(`Found ${sources.length} sources: ${sources.map(s => s.name).join(', ')}`);
      const sourcesDiv = $('#sources');
      sourcesDiv.innerHTML = '';
      if (sources.length === 0) {
        sourcesDiv.innerHTML = '<div>No sources found. Check permissions.</div>';
        return;
      }
      sources.forEach(s => {
        const div = document.createElement('div');
        div.textContent = s.name;
        div.dataset.sourceId = s.id;
        div.className = 'source-option';
        div.onclick = () => {
          sourcesDiv.querySelectorAll('.source-option').forEach(opt => opt.classList.remove('selected'));
          div.classList.add('selected');
        };
        sourcesDiv.appendChild(div);
      });
    } catch (error) {
      alert(`Error getting sources: ${error.message}`);
      $('#sources').innerHTML = '<div>Error loading sources. Check console.</div>';
      console.error('Sources error:', error);
    }
  }

  async function startFullShare() {
    const selectedSource = $('#sources .source-option.selected');
    if (!selectedSource) return alert('Please select a source.');
    const sourceId = selectedSource.dataset.sourceId;
    localStream = await window.electronAPI.getDisplayMediaBySourceId(sourceId);
    videoPlayer.srcObject = localStream; // Show on host
    setupPeer(localStream);
    send({ type: 'screenshare-start' });
  }

  async function startCroppedShare() {
    const selectedSource = $('#sources .source-option.selected');
    if (!selectedSource) return alert('Please select a source.');
    const sourceId = selectedSource.dataset.sourceId;
    localStream = await window.electronAPI.getDisplayMediaBySourceId(sourceId);
    sharePreview.srcObject = localStream;
    cropCanvas.width = localStream.getVideoTracks()[0].getSettings().width / 2; // Scale for performance
    cropCanvas.height = localStream.getVideoTracks()[0].getSettings().height / 2;
    const ctx = cropCanvas.getContext('2d');
    cropRect.classList.remove('hidden');
    let isDragging = false, startX, startY;

    cropCanvas.onmousedown = (e) => {
      isDragging = true;
      startX = e.offsetX;
      startY = e.offsetY;
      cropRect.style.left = `${startX}px`;
      cropRect.style.top = `${startY}px`;
      cropRect.style.width = '0px';
      cropRect.style.height = '0px';
    };

    cropCanvas.onmousemove = (e) => {
      if (isDragging) {
        const width = e.offsetX - startX;
        const height = e.offsetY - startY;
        cropRect.style.width = `${Math.abs(width)}px`;
        cropRect.style.height = `${Math.abs(height)}px`;
        cropRect.style.left = `${Math.abs(width) < 0 ? e.offsetX : startX}px`;
        cropRect.style.top = `${Math.abs(height) < 0 ? e.offsetY : startY}px`;
      }
    };

    cropCanvas.onmouseup = () => {
      isDragging = false;
      cropX = Math.min(startX, startX + parseInt(cropRect.style.width)) * 2; // Scale back
      cropY = Math.min(startY, startY + parseInt(cropRect.style.height)) * 2;
      cropWidth = parseInt(cropRect.style.width) * 2;
      cropHeight = parseInt(cropRect.style.height) * 2;
      if (cropWidth > 0 && cropHeight > 0) {
        const croppedStream = cropVideoStream(localStream, cropX, cropY, cropWidth, cropHeight);
        videoPlayer.srcObject = croppedStream; // Show on host
        setupPeer(croppedStream);
        send({ type: 'screenshare-start' });
        cropRect.classList.add('hidden');
      } else {
        alert('Please select a valid crop area.');
      }
    };

    function drawPreview() {
      ctx.drawImage(sharePreview, 0, 0, cropCanvas.width, cropCanvas.height);
      requestAnimationFrame(drawPreview);
    }
    drawPreview();
  }

  function cropVideoStream(stream, x, y, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    function draw() {
      ctx.drawImage(video, -x, -y, video.videoWidth, video.videoHeight);
      requestAnimationFrame(draw);
    }
    draw();
    return canvas.captureStream();
  }

  function setupPeer(stream) {
    const SimplePeer = require('simple-peer');
    peer = new SimplePeer({ initiator: state.isHost, stream });
    peer.on('signal', data => send({ type: 'webrtc-signal', signal: data }));
    peer.on('stream', remoteStream => remoteVideoPlayer.srcObject = remoteStream);
    peer.on('error', err => console.error('Peer error:', err));
  }

  function stopShare() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    if (peer) {
      peer.destroy();
      peer = null;
    }
    videoPlayer.srcObject = null;
    remoteVideoPlayer.srcObject = null;
    send({ type: 'screenshare-stop' });
    const selected = $('#sources .source-option.selected');
    if (selected) selected.classList.remove('selected');
  }

  // --- Event Listeners for Screenshare ---
  btnPickSource.onclick = () => {
    alert('Button clicked! Trying to load sources...');
    populateScreenSources();
  };
  btnStartShare.onclick = startFullShare;
  btnStartCropped.onclick = startCroppedShare;
  btnStopShare.onclick = stopShare;

  // Update WebSocket to handle WebRTC signaling
  function setupWebSocketMessageHandler() {
  if (!ws || ws.readyState === WebSocket.CLOSED) return; // Exit if ws isn’t ready
  const originalOnMessage = ws.onmessage;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'webrtc-signal' && peer) {
      peer.signal(msg.signal);
      return;
    }
    if (originalOnMessage) originalOnMessage(event); // Run original logic
  };
}
setupWebSocket(); // Ensure WebSocket is set up first
setupWebSocketMessageHandler(); // Set up message handler after
// --- Initial load ---
showView('access');
$('#btnRefresh').click();