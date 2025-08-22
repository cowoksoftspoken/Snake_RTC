const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const roleEl = document.getElementById("role");
const sigEl = document.getElementById("sig");
const rtcEl = document.getElementById("rtc");
const dcEl = document.getElementById("dc");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let ws;
let roomId = null;
let pc;
let dc;
let isHost = false;
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

const GRID_W = 30;
const GRID_H = 20;
const CELL = 30;

const TICK_MS = 100;
let gameInterval = null;
let rng = (
  (seed) => () =>
    (seed = (seed * 1664525 + 1013904223) >>> 0)
)(Date.now() & 0xffffffff);

const defaultState = () => ({
  apple: { x: 5, y: 5 },
  snakes: [
    {
      body: [
        { x: 8, y: 10 },
        { x: 7, y: 10 },
        { x: 6, y: 10 },
      ],
      dir: { x: 1, y: 0 },
      alive: true,
      score: 0,
    },
    {
      body: [
        { x: 22, y: 10 },
        { x: 23, y: 10 },
        { x: 24, y: 10 },
      ],
      dir: { x: -1, y: 0 },
      alive: true,
      score: 0,
    },
  ],
});
let state = defaultState();

const pendingInput = {
  0: null,
  1: null,
};

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

function step() {
  for (let i = 0; i < 2; i++) {
    const s = state.snakes[i];
    const inp = pendingInput[i];
    if (!inp) continue;
    if (inp.x !== -s.dir.x || inp.y !== -s.dir.y) {
      s.dir = inp;
    }
    pendingInput[i] = null;
  }

  for (let i = 0; i < 2; i++) {
    const s = state.snakes[i];
    if (!s.alive) continue;
    const head = s.body[0];
    const nx = clampWrap(head.x + s.dir.x, GRID_W);
    const ny = clampWrap(head.y + s.dir.y, GRID_H);

    const hitsSelf = s.body.some(
      (b, idx) => idx > 0 && b.x === nx && b.y === ny
    );
    const hitsOther = state.snakes[1 - i].body.some(
      (b) => b.x === nx && b.y === ny
    );
    if (hitsSelf || hitsOther) {
      s.alive = false;
      continue;
    }

    s.body.unshift({ x: nx, y: ny });

    if (nx === state.apple.x && ny === state.apple.y) {
      s.score += 1;
      spawnApple();
    } else {
      s.body.pop();
    }
  }

  if (!state.snakes[0].alive && !state.snakes[1].alive) {
    state = defaultState();
    spawnApple();
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

  const colors = ["#33ff6e", "#5cb0ff"];
  stateToDraw.snakes.forEach((s, idx) => {
    ctx.fillStyle = colors[idx];
    s.body.forEach((b, i) => {
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
}

function startHostLoop() {
  if (gameInterval) clearInterval(gameInterval);
  spawnApple();
  gameInterval = setInterval(() => {
    step();
    draw(state);
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({ t: "state", state }));
    }
  }, TICK_MS);
}

function stopLoop() {
  if (gameInterval) clearInterval(gameInterval);
  gameInterval = null;
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
  if (!dir) return;
  if (isHost) {
    pendingInput[0] = dir;
  } else {
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({ t: "input", player: 1, dir }));
    }
  }
});

function onDataChannelMessage(ev) {
  const msg = JSON.parse(ev.data);

  if (msg.t === "state" && !isHost) {
    draw(msg.state);
  }

  if (isHost && msg.t === "input") {
    const { player, dir } = msg;
    pendingInput[player] = dir;
  }

  if (msg.t === "reset") {
    state = defaultState();
    if (isHost) spawnApple();
  }
}

async function createConnection() {
  pc = new RTCPeerConnection(rtcConfig);
  pc.onconnectionstatechange = () => setRtcStatus(pc.connectionState);

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: "candidate", candidate: e.candidate });
  };

  if (isHost) {
    dc = pc.createDataChannel("game", { ordered: true });
    hookDataChannel();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: "offer", sdp: pc.localDescription });
  } else {
    pc.ondatachannel = (e) => {
      dc = e.channel;
      hookDataChannel();
    };
  }
}

function hookDataChannel() {
  dc.onopen = () => {
    setDcStatus("Open");
    if (isHost) startHostLoop();
  };
  dc.onclose = () => {
    setDcStatus("Closed");
    stopLoop();
  };
  dc.onmessage = onDataChannelMessage;
}

joinBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();

  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Isi room id dulu ya 🙏");
    return;
  }

  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
  );
  setSigStatus("Connecting…");

  ws.onopen = () => {
    setSigStatus("Connected");
    wsSend({ type: "join", room: roomId });
  };

  ws.onclose = () => setSigStatus("Disconnected");
  ws.onerror = () => setSigStatus("Error");

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);

    if (data.type === "room_full") {
      alert("Room penuh (max 2). Coba room lain ✌️");
      return;
    }

    if (data.type === "joined") {
      isHost = data.role === "host";
      setRole(isHost ? "Host (Player 1)" : "Guest (Player 2)");
      setRtcStatus("Waiting");
      setDcStatus("Closed");
    }

    if (data.type === "ready") {
      if (!pc) await createConnection();
    }

    if (data.type === "offer") {
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: "answer", sdp: pc.localDescription });
    }

    if (data.type === "answer") {
      await pc.setRemoteDescription(data.sdp);
    }

    if (data.type === "candidate") {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (e) {
        console.warn("Failed to add ICE candidate", e);
      }
    }

    if (data.type === "peer_left") {
      stopLoop();
      state = defaultState();
      draw(state);
      setRtcStatus("Peer left");
      setDcStatus("Closed");
      if (pc) {
        pc.close();
        pc = null;
      }
    }
  };
};

draw(defaultState());
