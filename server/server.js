@'
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      sistema: "DOOM WebSocket Multiplayer Arena",
      modo: "multijugador-tiempo-real",
      version: "2.1-ranking-sonidos-linea-vision",
      puerto: PORT
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("DOOM WebSocket Multiplayer Arena Server");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

const SPAWNS = {
  E1M1: [
    { x: 180, y: 180, angle: 0 },
    { x: 1250, y: 180, angle: Math.PI },
    { x: 180, y: 1050, angle: 0 },
    { x: 1300, y: 1050, angle: Math.PI },
    { x: 760, y: 570, angle: 0 }
  ],
  E1M2: [
    { x: 220, y: 220, angle: 0 },
    { x: 1500, y: 220, angle: Math.PI },
    { x: 220, y: 1150, angle: 0 },
    { x: 1500, y: 1150, angle: Math.PI },
    { x: 880, y: 700, angle: 0 }
  ],
  ARENA: [
    { x: 300, y: 300, angle: 0 },
    { x: 1450, y: 300, angle: Math.PI },
    { x: 300, y: 1200, angle: 0 },
    { x: 1450, y: 1200, angle: Math.PI },
    { x: 880, y: 760, angle: 0 }
  ],
  EXPO: [
    { x: 240, y: 240, angle: 0 },
    { x: 1150, y: 240, angle: Math.PI },
    { x: 240, y: 900, angle: 0 },
    { x: 1150, y: 900, angle: Math.PI }
  ]
};

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      clients: new Set(),
      players: new Map(),
      messages: []
    });
  }

  return rooms.get(roomName);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomName, data, except = null) {
  const room = getRoom(roomName);

  for (const client of room.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

function makeId() {
  return "P" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function cleanNick(nick) {
  return String(nick || "Jugador")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 24) || "Jugador";
}

function createPlayer(ws) {
  const list = SPAWNS[ws.roomName] || SPAWNS.E1M1;
  const spawn = list[Math.floor(Math.random() * list.length)];

  return {
    id: ws.id,
    nick: ws.nick,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    hp: 100,
    score: 0,
    alive: true
  };
}

wss.on("connection", (ws) => {
  ws.id = makeId();
  ws.roomName = null;
  ws.nick = null;
  ws.joined = false;

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      if (ws.joined && ws.roomName) {
        const oldRoom = getRoom(ws.roomName);
        oldRoom.clients.delete(ws);
        oldRoom.players.delete(ws.id);

        broadcast(ws.roomName, {
          type: "leave",
          id: ws.id,
          text: `${ws.nick} salió de la sala`,
          time: Date.now()
        });
      }

      ws.roomName = msg.room || "E1M1";
      ws.nick = cleanNick(msg.nick);
      ws.joined = true;

      const room = getRoom(ws.roomName);
      room.clients.add(ws);

      const player = createPlayer(ws);
      room.players.set(ws.id, player);

      send(ws, {
        type: "welcome",
        id: ws.id,
        room: ws.roomName,
        players: Array.from(room.players.values()),
        messages: room.messages
      });

      broadcast(ws.roomName, {
        type: "system",
        text: `${ws.nick} entró a la arena ${ws.roomName}`,
        time: Date.now()
      });

      return;
    }

    if (!ws.joined || !ws.roomName) {
      return;
    }

    if (msg.type === "state") {
      const room = getRoom(ws.roomName);
      const player = room.players.get(ws.id);

      if (!player) return;

      player.x = Number(msg.x) || player.x;
      player.y = Number(msg.y) || player.y;
      player.angle = Number(msg.angle) || player.angle;
      player.hp = msg.hp ?? player.hp;
      player.alive = msg.alive ?? player.alive;

      broadcast(ws.roomName, {
        type: "state",
        player
      }, ws);

      return;
    }

    if (msg.type === "chat") {
      const room = getRoom(ws.roomName);

      const text = String(msg.text || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 160);

      if (!text) return;

      const chatMessage = {
        id: ws.id,
        nick: ws.nick,
        text,
        time: Date.now()
      };

      room.messages.push(chatMessage);
      if (room.messages.length > 40) room.messages.shift();

      broadcast(ws.roomName, {
        type: "chat",
        message: chatMessage
      });

      return;
    }

    if (msg.type === "shoot") {
      broadcast(ws.roomName, {
        type: "shoot",
        id: ws.id,
        nick: ws.nick,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        angle: Number(msg.angle) || 0,
        time: Date.now()
      });

      return;
    }

    if (msg.type === "hit") {
      const room = getRoom(ws.roomName);
      const target = room.players.get(msg.targetId);
      const shooter = room.players.get(ws.id);

      if (!target || !shooter) return;
      if (!target.alive || !shooter.alive) return;

      target.hp = Math.max(0, target.hp - 20);

      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        shooter.score += 1;

        broadcast(ws.roomName, {
          type: "system",
          text: `${shooter.nick} eliminó a ${target.nick}`,
          time: Date.now()
        });
      }

      broadcast(ws.roomName, {
        type: "damage",
        targetId: target.id,
        shooterId: shooter.id,
        hp: target.hp,
        players: Array.from(room.players.values())
      });

      return;
    }

    if (msg.type === "respawn") {
      const room = getRoom(ws.roomName);
      const player = room.players.get(ws.id);

      if (!player) return;

      const list = SPAWNS[ws.roomName] || SPAWNS.E1M1;
      const spawn = list[Math.floor(Math.random() * list.length)];

      player.x = spawn.x;
      player.y = spawn.y;
      player.angle = spawn.angle;
      player.hp = 100;
      player.alive = true;

      broadcast(ws.roomName, {
        type: "respawn",
        player
      });

      return;
    }
  });

  ws.on("close", () => {
    if (!ws.joined || !ws.roomName) return;

    const room = getRoom(ws.roomName);
    room.clients.delete(ws);
    room.players.delete(ws.id);

    broadcast(ws.roomName, {
      type: "leave",
      id: ws.id,
      text: `${ws.nick} abandonó la arena`,
      time: Date.now()
    });
  });
});

server.listen(PORT, () => {
  console.log(`DOOM WebSocket Multiplayer Arena running on port ${PORT}`);
});
'@ | Set-Content -Path "C:\proyectos\websocket-doom-arena\server\server.js" -Encoding UTF8