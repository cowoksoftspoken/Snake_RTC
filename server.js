const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const MAX_PLAYERS = 4;
const rooms = new Map();
let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      clients: new Map(),
      hostId: null,
      slots: new Array(MAX_PLAYERS).fill(null),
    };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastRoomUpdate(room) {
  const payload = {
    type: "room_update",
    count: room.clients.size,
    max: MAX_PLAYERS,
    slots: room.slots.map((id) => Boolean(id)),
  };
  for (const client of room.clients.values()) send(client, payload);
}

function leaveRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) {
    ws.roomId = null;
    return;
  }

  const id = ws.id;
  const wasHost = room.hostId === id;
  room.clients.delete(id);

  const slotIndex = room.slots.indexOf(id);
  if (slotIndex !== -1) room.slots[slotIndex] = null;
  ws.roomId = null;

  if (wasHost) {
    for (const client of room.clients.values()) {
      client.roomId = null;
      send(client, { type: "host_left" });
    }
    rooms.delete(roomId);
    return;
  }

  const host = room.clients.get(room.hostId);
  if (host) send(host, { type: "peer_left", id, playerIndex: slotIndex });

  if (room.clients.size === 0) {
    rooms.delete(roomId);
  } else {
    broadcastRoomUpdate(room);
  }
}

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.id = `p${nextId++}`;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomId = data.room;
      if (!roomId) return;

      if (ws.roomId) leaveRoom(ws);

      const room = getRoom(roomId);

      if (room.clients.size >= MAX_PLAYERS) {
        return send(ws, { type: "room_full", max: MAX_PLAYERS });
      }

      const isHost = !room.hostId;
      let slotIndex = -1;

      if (isHost && !room.slots[0]) {
        slotIndex = 0;
      } else {
        for (let i = 1; i < MAX_PLAYERS; i++) {
          if (!room.slots[i]) {
            slotIndex = i;
            break;
          }
        }
      }

      if (slotIndex === -1) {
        return send(ws, { type: "room_full", max: MAX_PLAYERS });
      }

      room.clients.set(ws.id, ws);
      room.slots[slotIndex] = ws.id;
      ws.roomId = roomId;

      if (isHost) room.hostId = ws.id;

      send(ws, {
        type: "joined",
        id: ws.id,
        role: isHost ? "host" : "guest",
        playerIndex: slotIndex,
        hostId: room.hostId,
      });

      broadcastRoomUpdate(room);

      if (!isHost) {
        const host = room.clients.get(room.hostId);
        if (host) send(host, { type: "peer_joined", id: ws.id, playerIndex: slotIndex });
      }
      return;
    }

    if (["offer", "answer", "candidate"].includes(data.type)) {
      const room = rooms.get(ws.roomId);
      if (!room) return;

      const targetId = data.to;
      if (targetId) {
        const target = room.clients.get(targetId);
        if (target) send(target, { ...data, from: ws.id });
        return;
      }

      for (const client of room.clients.values()) {
        if (client !== ws) send(client, { ...data, from: ws.id });
      }
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
