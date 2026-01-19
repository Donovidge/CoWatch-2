// src/uploadStreamer.js
// Streams an uploaded <video> to a remote peer (audio + video), with canvas fallback.
// Call initUploadStreamer({ fileInput, videoEl, pc, sendSignal }) once at startup.

export function initUploadStreamer({ fileInput, videoEl, pc, sendSignal }) {
  if (!fileInput || !videoEl || !pc || !sendSignal) {
    throw new Error("[uploadStreamer] Missing required args: fileInput, videoEl, pc, sendSignal");
  }

  // Ensure renegotiation sends offers via your signaling
  pc.onnegotiationneeded = async () => {
    try {
      const offer = await pc.createOffer({ iceRestart: false });
      await pc.setLocalDescription(offer);
      sendSignal({ type: "offer", sdp: pc.localDescription.sdp });
    } catch (err) {
      console.error("[uploadStreamer] negotiation error:", err);
    }
  };

  // Typical ICE handling—forward local candidates to the other side (serialize!)
pc.onicecandidate = (e) => {
  if (e.candidate) {
    // Serialize to plain JSON so postMessage can clone it
    const safe = e.candidate.toJSON ? e.candidate.toJSON() : {
      candidate: e.candidate.candidate,
      sdpMid: e.candidate.sdpMid,
      sdpMLineIndex: e.candidate.sdpMLineIndex,
      usernameFragment: e.candidate.usernameFragment
    };
    sendSignal({ type: "ice", candidate: safe });
  }
};


  // When a file is chosen, load it into the <video> and then stream it
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    videoEl.src = url;

    // Attempt to play (autoplay might need a click)
    try { await videoEl.play(); } catch { /* user may press play */ }

    await streamVideoElementToPeer(videoEl, pc);
  });
}

/** Adds tracks from the video element to the RTCPeerConnection, replacing existing ones if present. */
async function streamVideoElementToPeer(videoEl, pc) {
  // Wait for frames to be available
  if (videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((res) => videoEl.addEventListener("loadeddata", res, { once: true }));
  }

  let stream = null;

  // Prefer native captureStream (Chromium/Electron)
  if (typeof videoEl.captureStream === "function") {
    stream = videoEl.captureStream();
  } else if (typeof videoEl.mozCaptureStream === "function") {
    stream = videoEl.mozCaptureStream();
  } else {
    // Canvas fallback: draw each frame, capture canvas stream; add audio via WebAudio
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth || 1280;
    canvas.height = videoEl.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      try { ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height); } catch {}
      requestAnimationFrame(draw);
    };
    draw();

    const fps = 30;
    const canvasStream = canvas.captureStream(fps);

    // Pipe audio from the <video> into the captured stream
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(videoEl);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    source.connect(audioCtx.destination); // keep local playback; optional
    dest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));

    stream = canvasStream;
  }

  addOrReplaceTracks(pc, stream);
}

function addOrReplaceTracks(pc, stream) {
  const senders = pc.getSenders();

  const vTrack = stream.getVideoTracks()[0];
  if (vTrack) {
    const vSender = senders.find((s) => s.track && s.track.kind === "video");
    if (vSender) vSender.replaceTrack(vTrack); else pc.addTrack(vTrack, stream);
  }

  const aTrack = stream.getAudioTracks()[0];
  if (aTrack) {
    const aSender = senders.find((s) => s.track && s.track.kind === "audio");
    if (aSender) aSender.replaceTrack(aTrack); else pc.addTrack(aTrack, stream);
  }
}
