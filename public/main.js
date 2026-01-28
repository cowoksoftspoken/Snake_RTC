const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const leaveBtn = document.getElementById("leaveBtn");
const roleEl = document.getElementById("role");
const sigEl = document.getElementById("sig");
const rtcEl = document.getElementById("rtc");
const dcEl = document.getElementById("dc");
const playersEl = document.getElementById("players");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const popup = document.getElementById("popup");
const popupText = document.getElementById("popupText");
const popupBtn = document.getElementById("popupBtn");

let ws;
let roomId = null;
let myId = null;
let playerIndex = null;
let isHost = false;
let hostId = null;
let connectedCount = 0;
let roundActive = false;
let roundEnded = false;
let pc = null;
let dc = null;
const peers = new Map();
const pendingGuestCandidates = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:5349" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:5349" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:5349" },
    { urls: "stun:stun3.l.google.com:3478" },
    { urls: "stun:stun3.l.google.com:5349" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:5349" },
  ],
};

const MAX_PLAYERS = 4;
const GRID_W = 30;
const GRID_H = 20;
const CELL = 30;
const TICK_MS = 100;

const activeSlots = new Array(MAX_PLAYERS).fill(false);

let gameInterval = null;
let rng = ((seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0))(
  Date.now() & 0xffffffff
);

const BASE_SNAKES = [
  {
    body: [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ],
    dir: { x: 1, y: 0 },
  },
  {
    body: [
      { x: 22, y: 10 },
      { x: 23, y: 10 },
      { x: 24, y: 10 },
    ],
    dir: { x: -1, y: 0 },
  },
  {
    body: [
      { x: 15, y: 4 },
      { x: 15, y: 3 },
      { x: 15, y: 2 },
    ],
    dir: { x: 0, y: 1 },
  },
  {
    body: [
      { x: 15, y: 16 },
      { x: 15, y: 17 },
      { x: 15, y: 18 },
    ],
    dir: { x: 0, y: -1 },
  },
];

const defaultState = () => ({
  apple: { x: 5, y: 5 },
  snakes: BASE_SNAKES.map((s) => ({
    body: s.body.map((b) => ({ x: b.x, y: b.y })),
    dir: { x: s.dir.x, y: s.dir.y },
    alive: true,
    score: 0,
  })),
});

let state = defaultState();
const pendingInput = new Array(MAX_PLAYERS).fill(null);

function setSigStatus(v) {
  sigEl.textContent = v;
}
function setRtcStatus(v) {
  rtcEl.textContent = v;
}
function setDcStatus(v) {
  dcEl.textContent = v;
}
function setRole(v) {
  roleEl.textContent = v;
}
function setPlayersStatus(count, max) {
  if (typeof count === "number" && typeof max === "number") {
    playersEl.textContent = `${count}/${max}`;
    return;
  }
  playersEl.textContent = `0/${MAX_PLAYERS}`;
}

function setJoinState(joined) {
  if (joinBtn) {
    joinBtn.disabled = joined;
  }
  if (roomInput) {
    roomInput.disabled = joined;
  }
  if (leaveBtn) {
    leaveBtn.disabled = !joined;
  }
}

function updateStartButton() {
  if (!startBtn) return;
  if (!isHost) {
    startBtn.disabled = true;
    startBtn.textContent = "Menunggu Host";
    return;
  }
  if (roundActive) {
    startBtn.disabled = true;
    startBtn.textContent = "Berjalan";
    return;
  }
  if (connectedCount < 2) {
    startBtn.disabled = true;
    startBtn.textContent = "Butuh 2 pemain";
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = roundEnded ? "Hidup Lagi" : "Mulai";
}

function showPopup(text) {
  if (!popup || !popupText) return;
  popupText.textContent = text;
  popup.classList.remove("hidden");
}

function hidePopup() {
  if (!popup) return;
  popup.classList.add("hidden");
}

function isPopupVisible() {
  return popup && !popup.classList.contains("hidden");
}

if (popupBtn) {
  popupBtn.onclick = hidePopup;
}

function updateRtcDisplay() {
  if (isHost) {
    const total = peers.size;
    const open = [...peers.values()].filter(
      (peer) => peer.dc && peer.dc.readyState === "open"
    ).length;
    if (total === 0) {
      setRtcStatus("Hosting");
      setDcStatus("Idle");
    } else {
      setRtcStatus(`Hosting (${open}/${total})`);
      setDcStatus(open > 0 ? "Open" : "Idle");
    }
    return;
  }

  setRtcStatus(pc ? pc.connectionState : "Idle");
  if (dc && dc.readyState === "open") {
    setDcStatus("Open");
  } else {
    setDcStatus("Closed");
  }
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function clampWrap(v, max) {
  return (v + max) % max;
}
function rnd(max) {
  return rng() % max;
}

function spawnApple() {
  let x, y, occupied;
  do {
    x = rnd(GRID_W);
    y = rnd(GRID_H);
    occupied = state.snakes.some((s) =>
      s.body.some((b) => b.x === x && b.y === y)
    );
  } while (occupied);
  state.apple = { x, y };
}

function deactivateSnake(index) {
  const target = state.snakes[index];
  if (!target) return;
  target.alive = false;
  target.body = [];
  target.score = 0;
  pendingInput[index] = null;
}

function tryRespawnSnake(index) {
  const base = BASE_SNAKES[index];
  const target = state.snakes[index];
  if (!base || !target) return false;

  const newBody = base.body.map((b) => ({ x: b.x, y: b.y }));
  const overlaps = state.snakes.some((s, sidx) => {
    if (sidx === index) return false;
    return s.body.some((b) => newBody.some((nb) => nb.x === b.x && nb.y === b.y));
  });

  if (overlaps) return false;

  state.snakes[index] = {
    body: newBody,
    dir: { x: base.dir.x, y: base.dir.y },
    alive: true,
    score: 0,
  };

  if (newBody.some((b) => b.x === state.apple.x && b.y === state.apple.y)) {
    spawnApple();
  }

  return true;
}

function syncActiveSlots(slots) {
  for (let i = 0; i < activeSlots.length; i++) {
    const isActive = Boolean(slots[i]);
    activeSlots[i] = isActive;
    if (!isActive) {
      deactivateSnake(i);
    } else if (state.snakes[i].body.length === 0) {
      tryRespawnSnake(i);
    }
  }
}

function step() {
  for (let i = 0; i < state.snakes.length; i++) {
    const s = state.snakes[i];
    const inp = pendingInput[i];
    if (!s.alive) {
      pendingInput[i] = null;
      continue;
    }
    if (!inp) continue;
    if (inp.x !== -s.dir.x || inp.y !== -s.dir.y) {
      s.dir = inp;
    }
    pendingInput[i] = null;
  }

  const nextHeads = state.snakes.map((s) => {
    if (!s.alive) return null;
    const head = s.body[0];
    return {
      x: clampWrap(head.x + s.dir.x, GRID_W),
      y: clampWrap(head.y + s.dir.y, GRID_H),
    };
  });

  const dead = new Set();
  const headBuckets = new Map();
  nextHeads.forEach((head, idx) => {
    if (!head) return;
    const key = `${head.x},${head.y}`;
    if (!headBuckets.has(key)) headBuckets.set(key, []);
    headBuckets.get(key).push(idx);
  });

  for (const indices of headBuckets.values()) {
    if (indices.length > 1) indices.forEach((idx) => dead.add(idx));
  }

  for (let i = 0; i < state.snakes.length; i++) {
    if (dead.has(i)) continue;
    const s = state.snakes[i];
    const head = nextHeads[i];
    if (!s.alive || !head) continue;

    const hitsSelf = s.body.some(
      (b, idx) => idx > 0 && b.x === head.x && b.y === head.y
    );
    if (hitsSelf) {
      dead.add(i);
      continue;
    }

    for (let j = 0; j < state.snakes.length; j++) {
      if (i === j) continue;
      const other = state.snakes[j];
      if (other.body.some((b) => b.x === head.x && b.y === head.y)) {
        dead.add(i);
        break;
      }
    }
  }

  let appleEaten = false;
  for (let i = 0; i < state.snakes.length; i++) {
    const s = state.snakes[i];
    const head = nextHeads[i];
    if (!s.alive || !head) continue;
    if (dead.has(i)) {
      s.alive = false;
      continue;
    }

    s.body.unshift(head);
    if (head.x === state.apple.x && head.y === state.apple.y) {
      s.score += 1;
      appleEaten = true;
    } else {
      s.body.pop();
    }
  }

  if (appleEaten) spawnApple();

  let aliveCount = 0;
  for (let i = 0; i < state.snakes.length; i++) {
    if (activeSlots[i] && state.snakes[i].alive) aliveCount += 1;
  }
  if (aliveCount <= 1) {
    endRound();
  }
}

function draw(stateToDraw) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.15;
  for (let x = 0; x <= GRID_W; x++) {
    ctx.fillRect(x * CELL, 0, 1, canvas.height);
  }
  for (let y = 0; y <= GRID_H; y++) {
    ctx.fillRect(0, y * CELL, canvas.width, 1);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#ff5c5c";
  ctx.fillRect(
    stateToDraw.apple.x * CELL,
    stateToDraw.apple.y * CELL,
    CELL,
    CELL
  );

  const colors = ["#33ff6e", "#5cb0ff", "#ffb84d", "#c96bff"];
  stateToDraw.snakes.forEach((s, idx) => {
    ctx.fillStyle = colors[idx];
    s.body.forEach((b) => {
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2);
    });
    if (!s.alive) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#000";
      s.body.forEach((b) =>
        ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2)
      );
      ctx.globalAlpha = 1;
    }
  });

  ctx.fillStyle = "#e6e6e6";
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`P1: ${stateToDraw.snakes[0].score}`, 10, 20);
  ctx.fillText(`P2: ${stateToDraw.snakes[1].score}`, 80, 20);
  ctx.fillText(`P3: ${stateToDraw.snakes[2].score}`, 150, 20);
  ctx.fillText(`P4: ${stateToDraw.snakes[3].score}`, 220, 20);
}

function getActiveIndices() {
  const indices = [];
  for (let i = 0; i < activeSlots.length; i++) {
    if (activeSlots[i]) indices.push(i);
  }
  return indices;
}

function buildResults() {
  const scores = state.snakes.map((s, idx) =>
    activeSlots[idx] ? s.score : null
  );
  const activeIndices = getActiveIndices();
  let maxScore = 0;
  if (activeIndices.length > 0) {
    maxScore = Math.max(...activeIndices.map((i) => scores[i]));
  }
  const winners = activeIndices.filter((i) => scores[i] === maxScore);
  return { scores, winners, maxScore };
}

function formatScoresLine(scores) {
  return scores
    .map((score, idx) => `P${idx + 1}: ${score === null ? "-" : score}`)
    .join(" | ");
}

function showGameOverPopup(results) {
  if (playerIndex === null) return;
  const myScore =
    typeof results.scores[playerIndex] === "number"
      ? results.scores[playerIndex]
      : 0;
  const isWinner = results.winners.includes(playerIndex);
  const isTie = results.winners.length > 1;
  const status = isWinner ? "Anda menang" : "Belum menang";
  const tieText = isWinner && isTie ? " (seri)" : "";
  const scoreLine = formatScoresLine(results.scores);
  const text = `${status}${tieText}. Skor Anda: ${myScore}. Skor tertinggi: ${results.maxScore}. Skor semua: ${scoreLine}.`;
  showPopup(text);
}

function broadcastGameOver(results) {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(JSON.stringify({ t: "game_over", results }));
    }
  }
}

function broadcastRoundStart() {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(JSON.stringify({ t: "round_start", state }));
    }
  }
}

function endRound() {
  if (!isHost || !roundActive) return;
  roundActive = false;
  roundEnded = true;
  draw(state);
  broadcastState();
  stopLoop();
  const results = buildResults();
  showGameOverPopup(results);
  broadcastGameOver(results);
  updateStartButton();
}

function broadcastState() {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(JSON.stringify({ t: "state", state }));
    }
  }
}

function startHostLoop() {
  if (!isHost) return;
  if (connectedCount < 2) return;
  if (gameInterval) clearInterval(gameInterval);
  roundActive = true;
  roundEnded = false;
  pendingInput.fill(null);
  state = defaultState();
  for (let i = 0; i < activeSlots.length; i++) {
    if (!activeSlots[i]) {
      deactivateSnake(i);
    }
  }
  spawnApple();
  draw(state);
  broadcastRoundStart();
  gameInterval = setInterval(() => {
    step();
    if (!roundActive) return;
    draw(state);
    broadcastState();
  }, TICK_MS);
  updateStartButton();
}

function stopLoop() {
  if (gameInterval) clearInterval(gameInterval);
  gameInterval = null;
  roundActive = false;
}

const KEY_TO_DIR = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  W: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  A: { x: -1, y: 0 },
  D: { x: 1, y: 0 },
};

window.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key];
  if (!dir || playerIndex === null || !roundActive) return;

  if (isHost) {
    pendingInput[playerIndex] = dir;
    return;
  }

  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ t: "input", dir }));
  }
});

function hookDataChannel(channel, peerInfo) {
  channel.onopen = () => {
    if (isHost && peerInfo) {
      updateRtcDisplay();
      if (peerInfo.dc && peerInfo.dc.readyState === "open") {
        const payload = roundActive
          ? { t: "round_start", state }
          : { t: "state", state };
        peerInfo.dc.send(JSON.stringify(payload));
      }
      return;
    }
    updateRtcDisplay();
  };

  channel.onclose = () => {
    updateRtcDisplay();
  };

  channel.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (isHost && peerInfo) {
      if (msg.t === "input" && roundActive) {
        pendingInput[peerInfo.playerIndex] = msg.dir;
      }
      return;
    }

    if (msg.t === "round_start") {
      roundActive = true;
      roundEnded = false;
      hidePopup();
      if (msg.state) draw(msg.state);
      updateStartButton();
      return;
    }

    if (msg.t === "state") {
      draw(msg.state);
      return;
    }

    if (msg.t === "game_over") {
      roundActive = false;
      roundEnded = true;
      showGameOverPopup(msg.results);
      updateStartButton();
    }
  };
}

async function createHostPeer(peerId, peerIndex) {
  if (peers.has(peerId)) return;
  const peerPc = new RTCPeerConnection(rtcConfig);
  const peer = {
    id: peerId,
    playerIndex: peerIndex,
    pc: peerPc,
    dc: null,
    pendingCandidates: [],
  };
  peers.set(peerId, peer);

  peerPc.onconnectionstatechange = () => updateRtcDisplay();
  peerPc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: "candidate", to: peerId, candidate: e.candidate });
  };

  const peerDc = peerPc.createDataChannel("game", { ordered: true });
  peer.dc = peerDc;
  hookDataChannel(peerDc, peer);

  const offer = await peerPc.createOffer();
  await peerPc.setLocalDescription(offer);
  wsSend({ type: "offer", to: peerId, sdp: peerPc.localDescription });
  updateRtcDisplay();
}

async function ensureGuestConnection() {
  if (pc) return;
  pc = new RTCPeerConnection(rtcConfig);
  pc.onconnectionstatechange = () => updateRtcDisplay();
  pc.onicecandidate = (e) => {
    if (e.candidate && hostId) {
      wsSend({ type: "candidate", to: hostId, candidate: e.candidate });
    }
  };
  pc.ondatachannel = (e) => {
    dc = e.channel;
    hookDataChannel(dc);
  };
  updateRtcDisplay();
}

function closePeer(peer) {
  if (peer.dc) peer.dc.close();
  if (peer.pc) peer.pc.close();
}

function resetConnections() {
  if (dc) dc.close();
  if (pc) pc.close();
  dc = null;
  pc = null;
  for (const peer of peers.values()) closePeer(peer);
  peers.clear();
  pendingGuestCandidates.length = 0;
  updateRtcDisplay();
}

function resetSession() {
  pendingInput.fill(null);
  roundActive = false;
  roundEnded = false;
  state = defaultState();
  draw(state);
  hidePopup();
  updateStartButton();
}

if (startBtn) {
  startBtn.onclick = () => {
    if (!isHost) return;
    if (roundActive) return;
    if (connectedCount < 2) return;
    hidePopup();
    startHostLoop();
  };
}

function leaveRoom() {
  if (!ws) return;
  ws.close();
}

if (leaveBtn) {
  leaveBtn.onclick = leaveRoom;
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  if (isPopupVisible() && (e.key === "Enter" || e.key === "Escape")) {
    e.preventDefault();
    hidePopup();
    return;
  }

  if (e.key === "Escape") {
    if (leaveBtn && !leaveBtn.disabled) {
      e.preventDefault();
      leaveBtn.click();
    }
    return;
  }

  if (e.key === "Enter") {
    if (startBtn && !startBtn.disabled) {
      e.preventDefault();
      startBtn.click();
      return;
    }
    if (joinBtn && !joinBtn.disabled) {
      e.preventDefault();
      joinBtn.click();
    }
  }
});

joinBtn.onclick = () => {
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  isHost = false;
  playerIndex = null;
  hostId = null;
  myId = null;
  connectedCount = 0;
  activeSlots.fill(false);

  resetConnections();
  stopLoop();
  resetSession();
  setRole("-");
  setPlayersStatus(0, MAX_PLAYERS);
  setJoinState(false);

  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Isi room id dulu ya.");
    return;
  }

  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
  );
  setSigStatus("Connecting...");

  ws.onopen = () => {
    setSigStatus("Connected");
    wsSend({ type: "join", room: roomId });
  };

  ws.onclose = () => {
    setSigStatus("Disconnected");
    isHost = false;
    playerIndex = null;
    hostId = null;
    myId = null;
    connectedCount = 0;
    activeSlots.fill(false);
    stopLoop();
    resetConnections();
    resetSession();
    setRole("-");
    setPlayersStatus(0, MAX_PLAYERS);
    setJoinState(false);
    setRtcStatus("Idle");
    setDcStatus("Closed");
  };
  ws.onerror = () => setSigStatus("Error");

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);

    if (data.type === "room_full") {
      alert(`Room penuh (max ${data.max || MAX_PLAYERS}). Coba room lain.`);
      return;
    }

    if (data.type === "joined") {
      myId = data.id;
      isHost = data.role === "host";
      playerIndex = data.playerIndex;
      hostId = data.hostId;
      setRole(isHost ? "Host (Player 1)" : `Player ${playerIndex + 1}`);
      roundActive = false;
      roundEnded = false;
      hidePopup();
      setJoinState(true);
      if (isHost) {
        activeSlots.fill(false);
        activeSlots[playerIndex] = true;
        state = defaultState();
        for (let i = 0; i < state.snakes.length; i++) {
          if (i !== playerIndex) deactivateSnake(i);
        }
        spawnApple();
        draw(state);
      }
      updateRtcDisplay();
      updateStartButton();
      return;
    }

    if (data.type === "room_update") {
      connectedCount = data.count;
      setPlayersStatus(data.count, data.max);
      if (isHost && Array.isArray(data.slots)) {
        syncActiveSlots(data.slots);
        if (!roundActive) draw(state);
      }
      updateStartButton();
      return;
    }

    if (data.type === "peer_joined" && isHost) {
      activeSlots[data.playerIndex] = true;
      tryRespawnSnake(data.playerIndex);
      if (!roundActive) draw(state);
      await createHostPeer(data.id, data.playerIndex);
      return;
    }

    if (data.type === "offer" && !isHost) {
      hostId = data.from || hostId;
      await ensureGuestConnection();
      await pc.setRemoteDescription(data.sdp);
      while (pendingGuestCandidates.length > 0) {
        const candidate = pendingGuestCandidates.shift();
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn("Failed to add ICE candidate", e);
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: "answer", to: data.from, sdp: pc.localDescription });
      return;
    }

    if (data.type === "answer" && isHost) {
      const peer = peers.get(data.from);
      if (!peer) return;
      await peer.pc.setRemoteDescription(data.sdp);
      while (peer.pendingCandidates.length > 0) {
        const candidate = peer.pendingCandidates.shift();
        try {
          await peer.pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn("Failed to add ICE candidate", e);
        }
      }
      return;
    }

    if (data.type === "candidate") {
      try {
        if (isHost) {
          const peer = peers.get(data.from);
          if (peer) {
            if (peer.pc.remoteDescription) {
              await peer.pc.addIceCandidate(data.candidate);
            } else {
              peer.pendingCandidates.push(data.candidate);
            }
          }
        } else {
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(data.candidate);
          } else {
            pendingGuestCandidates.push(data.candidate);
          }
        }
      } catch (e) {
        console.warn("Failed to add ICE candidate", e);
      }
      return;
    }

    if (data.type === "peer_left" && isHost) {
      const peer = peers.get(data.id);
      if (peer) {
        closePeer(peer);
        peers.delete(data.id);
        updateRtcDisplay();
      }
      const leavingIndex =
        typeof data.playerIndex === "number"
          ? data.playerIndex
          : peer
            ? peer.playerIndex
            : null;
      if (typeof leavingIndex === "number") {
        activeSlots[leavingIndex] = false;
        deactivateSnake(leavingIndex);
        if (!roundActive) draw(state);
      }
      updateStartButton();
      return;
    }

    if (data.type === "host_left") {
      isHost = false;
      playerIndex = null;
      hostId = null;
      myId = null;
      connectedCount = 0;
      activeSlots.fill(false);
      stopLoop();
      resetConnections();
      resetSession();
      setRole("-");
      setRtcStatus("Host left");
      setDcStatus("Closed");
      setPlayersStatus(0, MAX_PLAYERS);
      setJoinState(false);
    }
  };
};

draw(defaultState());
setJoinState(false);
updateStartButton();
