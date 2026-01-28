const roomInput = document.getElementById("room");
const nameInput = document.getElementById("username");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const leaveBtn = document.getElementById("leaveBtn");
const roleEl = document.getElementById("role");
const sigEl = document.getElementById("sig");
const rtcEl = document.getElementById("rtc");
const dcEl = document.getElementById("dc");
const playersEl = document.getElementById("players");
const namesEl = document.getElementById("names");
const skillsEl = document.getElementById("skills");
const cooldownsEl = document.getElementById("cooldowns");
const leaderboardEl = document.getElementById("leaderboard");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const popup = document.getElementById("popup");
const popupText = document.getElementById("popupText");
const popupBtn = document.getElementById("popupBtn");

let ws;
let roomId = null;
let myId = null;
let myName = "";
let playerIndex = null;
let isHost = false;
let hostId = null;
let connectedCount = 0;
let roundActive = false;
let roundEnded = false;
let isJoined = false;
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
const MAX_NAME_LEN = 16;
const GHOST_TICKS = 6;
const SKILL_COOLDOWN_TICKS = 80;

const SKILLS = [
  { name: "Shield", desc: "Tahan 1 tabrakan" },
  { name: "Ghost", desc: "Tembus snake 6 langkah" },
  { name: "Blink", desc: "Teleport acak" },
  { name: "Grow", desc: "+2 panjang instan" },
];

const activeSlots = new Array(MAX_PLAYERS).fill(false);
const slotNames = new Array(MAX_PLAYERS).fill(null);
const shieldFlags = new Array(MAX_PLAYERS).fill(false);
const ghostTicks = new Array(MAX_PLAYERS).fill(0);
const skillCooldowns = new Array(MAX_PLAYERS).fill(0);
const lastScores = new Array(MAX_PLAYERS).fill(0);
const winCounts = new Array(MAX_PLAYERS).fill(0);
const skillActiveTicks = new Array(MAX_PLAYERS).fill(0);

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

function resetSkillStates() {
  shieldFlags.fill(false);
  ghostTicks.fill(0);
  skillCooldowns.fill(0);
  lastScores.fill(0);
  skillActiveTicks.fill(0);
  updateSkillUi();
}

function createRoundState() {
  const newState = defaultState();
  newState.apple = { x: rnd(GRID_W), y: rnd(GRID_H) };
  state = newState;
  newState.snakes.forEach((s) => {
    s.body = [];
    s.alive = false;
    s.score = 0;
  });
  newState.snakes = newState.snakes.map((s, idx) => {
    if (!activeSlots[idx]) return s;
    const spawn = randomSnakeBody(3, idx);
    if (!spawn) return s;
    return {
      body: spawn.body,
      dir: { x: spawn.dir.x, y: spawn.dir.y },
      alive: true,
      score: 0,
    };
  });
  state = newState;
  spawnApple();
}

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

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LEN);
}

function setNamesStatus(names = slotNames) {
  if (!namesEl) return;
  const text = names
    .map((name, idx) => {
      const skill = SKILLS[idx] ? SKILLS[idx].name : "-";
      const label = name ? `${name}` : "-";
      return `P${idx + 1}:${label}(${skill})`;
    })
    .join(" ");
  namesEl.textContent = text || "-";
}

function setSkillStatus() {
  if (!skillsEl) return;
  const text = new Array(MAX_PLAYERS).fill(null).map((_, idx) => {
    if (!activeSlots[idx]) return `P${idx + 1}:-`;
    let active = "OFF";
    if (idx === 0 && shieldFlags[idx]) active = "ON";
    if (idx === 1 && ghostTicks[idx] > 0) active = `ON(${ghostTicks[idx]})`;
    if ((idx === 2 || idx === 3) && skillActiveTicks[idx] > 0) active = "ON";
    return `P${idx + 1}:${active}`;
  }).join(" ");
  skillsEl.textContent = text || "-";
}

function setCooldownStatus() {
  if (!cooldownsEl) return;
  const text = skillCooldowns
    .map((cd, idx) => {
      if (!activeSlots[idx]) return `P${idx + 1}:-`;
      const left = Math.max(0, cd);
      return `P${idx + 1}:${left}`;
    })
    .join(" ");
  cooldownsEl.textContent = text || "-";
}

function updateSkillUi() {
  setSkillStatus();
  setCooldownStatus();
}

function updateLeaderboard() {
  if (!leaderboardEl) return;
  const entries = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const name = slotNames[i] || `P${i + 1}`;
    const wins = winCounts[i] || 0;
    if (name !== "-" && (wins > 0 || activeSlots[i])) {
      entries.push({ name, wins, idx: i });
    }
  }
  entries.sort((a, b) => b.wins - a.wins || a.idx - b.idx);
  if (entries.length === 0) {
    leaderboardEl.textContent = "-";
    return;
  }
  leaderboardEl.textContent = entries.map((e) => `${e.name}: ${e.wins}`).join(" | ");
}

function setJoinState(joined) {
  if (joinBtn) {
    joinBtn.disabled = joined;
  }
  if (roomInput) {
    roomInput.disabled = joined;
  }
  if (nameInput) {
    nameInput.disabled = joined;
  }
  updateLeaveButton();
}

function updateLeaveButton() {
  if (!leaveBtn) return;
  if (!isJoined) {
    leaveBtn.disabled = true;
    return;
  }
  leaveBtn.disabled = roundActive;
}

function updateStartButton() {
  if (!startBtn) return;
  if (!isHost) {
    startBtn.disabled = true;
    startBtn.textContent = "Menunggu Host";
    updateLeaveButton();
    return;
  }
  if (roundActive) {
    startBtn.disabled = true;
    startBtn.textContent = "Berjalan";
    updateLeaveButton();
    return;
  }
  if (connectedCount < 2) {
    startBtn.disabled = true;
    startBtn.textContent = "Butuh 2 pemain";
    updateLeaveButton();
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = roundEnded ? "Hidup Lagi" : "Mulai";
  updateLeaveButton();
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

let audioCtx = null;

function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type = "sine", gain = 0.08) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(ctx.destination);
  const now = ctx.currentTime;
  osc.start(now);
  osc.stop(now + duration);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
}

function playSequence(notes) {
  const ctx = getAudioContext();
  if (!ctx) return;
  let time = ctx.currentTime;
  notes.forEach((note) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = note.type || "sine";
    osc.frequency.value = note.freq;
    g.gain.value = note.gain || 0.08;
    osc.connect(g).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + note.dur);
    g.gain.setValueAtTime(note.gain || 0.08, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + note.dur);
    time += note.dur;
  });
}

function playAppleSound() {
  playSequence([
    { freq: 660, dur: 0.06, type: "square", gain: 0.06 },
    { freq: 990, dur: 0.08, type: "square", gain: 0.05 },
  ]);
}

function playWinSound() {
  playSequence([
    { freq: 523.25, dur: 0.12, type: "sine", gain: 0.08 },
    { freq: 659.25, dur: 0.12, type: "sine", gain: 0.08 },
    { freq: 783.99, dur: 0.16, type: "sine", gain: 0.08 },
  ]);
}

function playLoseSound() {
  playSequence([
    { freq: 392.0, dur: 0.18, type: "sawtooth", gain: 0.06 },
    { freq: 293.66, dur: 0.22, type: "sawtooth", gain: 0.05 },
  ]);
}

function syncScores(newState) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    lastScores[i] = newState.snakes[i]?.score || 0;
  }
}

function handleScoreSounds(newState) {
  let ate = false;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const score = newState.snakes[i]?.score || 0;
    if (score > lastScores[i]) ate = true;
    lastScores[i] = score;
  }
  if (ate) playAppleSound();
}

function buildBodyFromHead(head, dir, length) {
  const body = [];
  for (let i = 0; i < length; i++) {
    body.push({
      x: clampWrap(head.x - dir.x * i, GRID_W),
      y: clampWrap(head.y - dir.y * i, GRID_H),
    });
  }
  return body;
}

function collectOccupied(excludeIndex = null) {
  const occupied = new Set();
  state.snakes.forEach((s, idx) => {
    if (excludeIndex !== null && idx === excludeIndex) return;
    s.body.forEach((b) => occupied.add(`${b.x},${b.y}`));
  });
  return occupied;
}

function randomSnakeBody(length, excludeIndex = null) {
  const occupied = collectOccupied(excludeIndex);
  if (state.apple) occupied.add(`${state.apple.x},${state.apple.y}`);
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let attempt = 0; attempt < 200; attempt++) {
    const dir = dirs[rnd(dirs.length)];
    const head = { x: rnd(GRID_W), y: rnd(GRID_H) };
    const body = buildBodyFromHead(head, dir, length);
    const overlaps = body.some((b) => occupied.has(`${b.x},${b.y}`));
    if (!overlaps) return { body, dir };
  }
  return null;
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
  shieldFlags[index] = false;
  ghostTicks[index] = 0;
  skillCooldowns[index] = 0;
  skillActiveTicks[index] = 0;
  updateSkillUi();
}

function tryRespawnSnake(index) {
  const target = state.snakes[index];
  if (!target) return false;

  const spawn = randomSnakeBody(3, index);
  if (!spawn) return false;

  state.snakes[index] = {
    body: spawn.body,
    dir: { x: spawn.dir.x, y: spawn.dir.y },
    alive: true,
    score: 0,
  };

  if (spawn.body.some((b) => b.x === state.apple.x && b.y === state.apple.y)) {
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
  updateSkillUi();
  updateLeaderboard();
}

function setActiveSlotsFromServer(slots) {
  for (let i = 0; i < activeSlots.length; i++) {
    activeSlots[i] = Boolean(slots[i]);
  }
  updateSkillUi();
  updateLeaderboard();
}

function consumeShield(index) {
  if (shieldFlags[index]) {
    shieldFlags[index] = false;
    updateSkillUi();
    return true;
  }
  return false;
}

function activateSkill(index) {
  if (!isHost) return;
  const s = state.snakes[index];
  if (!s || !s.alive) return;
  if (skillCooldowns[index] > 0) return;

  if (index === 0) {
    shieldFlags[index] = true;
    skillCooldowns[index] = SKILL_COOLDOWN_TICKS;
    skillActiveTicks[index] = 0;
    updateSkillUi();
    return;
  }

  if (index === 1) {
    ghostTicks[index] = GHOST_TICKS;
    skillCooldowns[index] = SKILL_COOLDOWN_TICKS;
    skillActiveTicks[index] = 0;
    updateSkillUi();
    return;
  }

  if (index === 2) {
    const spawn = randomSnakeBody(s.body.length, index);
    if (!spawn) return;
    s.body = spawn.body;
    s.dir = { x: spawn.dir.x, y: spawn.dir.y };
    skillCooldowns[index] = SKILL_COOLDOWN_TICKS;
    skillActiveTicks[index] = 8;
    updateSkillUi();
    return;
  }

  if (index === 3) {
    const tail = s.body[s.body.length - 1];
    if (tail) {
      s.body.push({ x: tail.x, y: tail.y });
      s.body.push({ x: tail.x, y: tail.y });
      skillCooldowns[index] = SKILL_COOLDOWN_TICKS;
      skillActiveTicks[index] = 8;
      updateSkillUi();
    }
  }
}

function step() {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (skillCooldowns[i] > 0) skillCooldowns[i] -= 1;
    if (ghostTicks[i] > 0) ghostTicks[i] -= 1;
    if (skillActiveTicks[i] > 0) skillActiveTicks[i] -= 1;
  }
  updateSkillUi();

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

  const tryKill = (idx) => {
    if (consumeShield(idx)) return;
    dead.add(idx);
  };

  for (const indices of headBuckets.values()) {
    if (indices.length > 1) {
      indices.forEach((idx) => {
        if (ghostTicks[idx] === 0) tryKill(idx);
      });
    }
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
      tryKill(i);
      continue;
    }

    if (ghostTicks[i] > 0) continue;
    for (let j = 0; j < state.snakes.length; j++) {
      if (i === j) continue;
      const other = state.snakes[j];
      if (other.body.some((b) => b.x === head.x && b.y === head.y)) {
        tryKill(i);
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
      s.body = [];
      shieldFlags[i] = false;
      ghostTicks[i] = 0;
      skillCooldowns[i] = 0;
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

  if (appleEaten) {
    spawnApple();
    handleScoreSounds(state);
  }

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

  stateToDraw.snakes.forEach((s, idx) => {
    if (!s.body.length) return;
    const head = s.body[0];
    const x = head.x * CELL + CELL / 2;
    const y = head.y * CELL + CELL / 2;
    const hasShield = idx === 0 && shieldFlags[idx];
    const hasGhost = idx === 1 && ghostTicks[idx] > 0;
    const hasBurst = (idx === 2 || idx === 3) && skillActiveTicks[idx] > 0;
    if (!hasShield && !hasGhost && !hasBurst) return;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = hasShield
      ? "rgba(120, 220, 255, 0.95)"
      : hasGhost
        ? "rgba(255, 255, 255, 0.85)"
        : "rgba(255, 203, 90, 0.95)";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  stateToDraw.snakes.forEach((s, idx) => {
    if (!s.body.length) return;
    const name = slotNames[idx] || `P${idx + 1}`;
    const head = s.body[0];
    const x = head.x * CELL + CELL / 2;
    const y = head.y * CELL - 4;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = "#e6e6e6";
    ctx.strokeText(name, x, y);
    ctx.fillText(name, x, y);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#e6e6e6";
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(
    `${slotNames[0] || "P1"}: ${stateToDraw.snakes[0].score}`,
    10,
    20
  );
  ctx.fillText(
    `${slotNames[1] || "P2"}: ${stateToDraw.snakes[1].score}`,
    180,
    20
  );
  ctx.fillText(
    `${slotNames[2] || "P3"}: ${stateToDraw.snakes[2].score}`,
    350,
    20
  );
  ctx.fillText(
    `${slotNames[3] || "P4"}: ${stateToDraw.snakes[3].score}`,
    520,
    20
  );
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
  if (isWinner) {
    playWinSound();
  } else {
    playLoseSound();
  }
  showPopup(text);
}

function broadcastGameOver(results) {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(JSON.stringify({ t: "game_over", results, wins: winCounts }));
    }
  }
}

function broadcastRoundStart() {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(
        JSON.stringify({
          t: "round_start",
          state,
          skills: {
            shields: shieldFlags,
            ghosts: ghostTicks,
            cooldowns: skillCooldowns,
            actives: skillActiveTicks,
          },
        })
      );
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
  results.winners.forEach((idx) => {
    if (typeof idx === "number") winCounts[idx] += 1;
  });
  updateLeaderboard();
  showGameOverPopup(results);
  broadcastGameOver(results);
  updateStartButton();
}

function broadcastState() {
  for (const peer of peers.values()) {
    if (peer.dc && peer.dc.readyState === "open") {
      peer.dc.send(
        JSON.stringify({
          t: "state",
          state,
          skills: {
            shields: shieldFlags,
            ghosts: ghostTicks,
            cooldowns: skillCooldowns,
            actives: skillActiveTicks,
          },
        })
      );
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
  resetSkillStates();
  createRoundState();
  syncScores(state);
  updateSkillUi();
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
const SKILL_KEY = "Shift";
const RESPAWN_KEY = "r";

window.addEventListener("keydown", (e) => {
  if (e.key === SKILL_KEY) {
    if (playerIndex === null || !roundActive) return;
    if (isHost) {
      activateSkill(playerIndex);
    } else if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({ t: "skill" }));
    }
    return;
  }

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
          ? {
              t: "round_start",
              state,
              skills: {
                shields: shieldFlags,
                ghosts: ghostTicks,
                cooldowns: skillCooldowns,
                actives: skillActiveTicks,
              },
            }
          : {
              t: "state",
              state,
              skills: {
                shields: shieldFlags,
                ghosts: ghostTicks,
                cooldowns: skillCooldowns,
                actives: skillActiveTicks,
              },
            };
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
      if (msg.t === "skill" && roundActive) {
        activateSkill(peerInfo.playerIndex);
      }
      return;
    }

    if (msg.t === "round_start") {
      roundActive = true;
      roundEnded = false;
      hidePopup();
      if (msg.state) {
        syncScores(msg.state);
        draw(msg.state);
      }
      if (msg.skills) {
        if (Array.isArray(msg.skills.shields)) {
          for (let i = 0; i < MAX_PLAYERS; i++) shieldFlags[i] = !!msg.skills.shields[i];
        }
        if (Array.isArray(msg.skills.ghosts)) {
          for (let i = 0; i < MAX_PLAYERS; i++) ghostTicks[i] = msg.skills.ghosts[i] || 0;
        }
        if (Array.isArray(msg.skills.cooldowns)) {
          for (let i = 0; i < MAX_PLAYERS; i++) skillCooldowns[i] = msg.skills.cooldowns[i] || 0;
        }
        if (Array.isArray(msg.skills.actives)) {
          for (let i = 0; i < MAX_PLAYERS; i++) skillActiveTicks[i] = msg.skills.actives[i] || 0;
        }
        updateSkillUi();
      }
      updateStartButton();
      return;
    }

    if (msg.t === "state") {
      handleScoreSounds(msg.state);
      draw(msg.state);
      if (msg.skills) {
        if (Array.isArray(msg.skills.shields)) {
          for (let i = 0; i < MAX_PLAYERS; i++) shieldFlags[i] = !!msg.skills.shields[i];
        }
        if (Array.isArray(msg.skills.ghosts)) {
          for (let i = 0; i < MAX_PLAYERS; i++) ghostTicks[i] = msg.skills.ghosts[i] || 0;
        }
        if (Array.isArray(msg.skills.cooldowns)) {
          for (let i = 0; i < MAX_PLAYERS; i++) skillCooldowns[i] = msg.skills.cooldowns[i] || 0;
        }
        if (Array.isArray(msg.skills.actives)) {
          for (let i = 0; i < MAX_PLAYERS; i++) skillActiveTicks[i] = msg.skills.actives[i] || 0;
        }
        updateSkillUi();
      }
      return;
    }

    if (msg.t === "game_over") {
      roundActive = false;
      roundEnded = true;
      if (Array.isArray(msg.wins)) {
        for (let i = 0; i < MAX_PLAYERS; i++) winCounts[i] = msg.wins[i] || 0;
        updateLeaderboard();
      }
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
  resetSkillStates();
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
  if (roundActive) {
    showPopup("Tidak bisa leave saat game berjalan.");
    return;
  }
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

  if (
    isHost &&
    !roundActive &&
    roundEnded &&
    (e.key === RESPAWN_KEY || e.key === RESPAWN_KEY.toUpperCase())
  ) {
    e.preventDefault();
    startHostLoop();
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
  slotNames.fill(null);
  setNamesStatus();
  winCounts.fill(0);
  updateLeaderboard();
  myName = normalizeName(nameInput ? nameInput.value : "");

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
    wsSend({ type: "join", room: roomId, name: myName });
  };

  ws.onclose = () => {
    setSigStatus("Disconnected");
    isHost = false;
    playerIndex = null;
    hostId = null;
    myId = null;
    connectedCount = 0;
    activeSlots.fill(false);
    slotNames.fill(null);
    setNamesStatus();
    isJoined = false;
    winCounts.fill(0);
    updateLeaderboard();
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
      if (typeof data.name === "string") {
        myName = data.name;
        if (nameInput) nameInput.value = myName;
      }
      if (typeof playerIndex === "number") {
        activeSlots[playerIndex] = true;
        slotNames[playerIndex] = myName || `Player ${playerIndex + 1}`;
        setNamesStatus();
        updateSkillUi();
      }
      isJoined = true;
      updateLeaderboard();
      setRole(isHost ? "Host (Player 1)" : `Player ${playerIndex + 1}`);
      roundActive = false;
      roundEnded = false;
      hidePopup();
      setJoinState(true);
      if (isHost) {
        activeSlots.fill(false);
        activeSlots[playerIndex] = true;
        state = defaultState();
        resetSkillStates();
        for (let i = 0; i < state.snakes.length; i++) {
          if (i !== playerIndex) {
            deactivateSnake(i);
          } else {
            const spawn = randomSnakeBody(3, i);
            if (spawn) {
              state.snakes[i].body = spawn.body;
              state.snakes[i].dir = { x: spawn.dir.x, y: spawn.dir.y };
            }
          }
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
      if (Array.isArray(data.names)) {
        for (let i = 0; i < MAX_PLAYERS; i++) {
          slotNames[i] = data.names[i] || null;
        }
        setNamesStatus();
        updateLeaderboard();
      }
      if (Array.isArray(data.slots)) {
        if (isHost) {
          syncActiveSlots(data.slots);
          if (!roundActive) draw(state);
        } else {
          setActiveSlotsFromServer(data.slots);
        }
      }
      updateStartButton();
      return;
    }

    if (data.type === "peer_joined" && isHost) {
      activeSlots[data.playerIndex] = true;
      if (typeof data.name === "string") {
        slotNames[data.playerIndex] = data.name;
        setNamesStatus();
        updateLeaderboard();
      }
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
        slotNames[leavingIndex] = null;
        setNamesStatus();
        updateLeaderboard();
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
      slotNames.fill(null);
      setNamesStatus();
      isJoined = false;
      winCounts.fill(0);
      updateLeaderboard();
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
setNamesStatus();
updateLeaderboard();
updateStartButton();
