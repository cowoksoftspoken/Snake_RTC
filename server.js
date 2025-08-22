const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomId = data.room;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);

      if (room.size >= 2) {
        return send(ws, { type: "room_full" });
      }

      ws.roomId = roomId;
      room.add(ws);

      const isHost = room.size === 1;
      send(ws, { type: "joined", role: isHost ? "host" : "guest" });

      if (room.size === 2) {
        for (const client of room) {
          send(client, { type: "ready" });
        }
      }
      return;
    }

    if (["offer", "answer", "candidate"].includes(data.type)) {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      for (const client of room) {
        if (client !== ws) send(client, data);
      }
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.delete(ws);
    for (const client of room) send(client, { type: "peer_left" });
    if (room.size === 0) rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
