const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = "SALAS_PERSISTENTES_CAMBIO_SALA_2026_05_16";

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB_FILE = path.join(__dirname, "messages-db.json");
const clients = new Map();

function defaultDatabase() {
  return {
    version: VERSION,
    rooms: {},
    messages: []
  };
}

function normalizeDatabase(value) {
  const db = value && typeof value === "object" ? value : {};

  if (!Array.isArray(db.messages)) db.messages = [];
  if (!db.rooms || typeof db.rooms !== "object" || Array.isArray(db.rooms)) {
    db.rooms = {};
  }

  db.version = VERSION;
  return db;
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDatabase(), null, 2));
    }

    const content = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(content || "{}");

    return normalizeDatabase(parsed);
  } catch (error) {
    console.log("Error cargando base de datos:", error.message);
    return defaultDatabase();
  }
}

let db = loadDatabase();

function saveDatabase() {
  try {
    db = normalizeDatabase(db);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.log("Error guardando base de datos:", error.message);
  }
}

app.get("/", (req, res) => {
  res.send(
    "Servidor WebSocket Demo activo con salas persistentes, historial, cambio de sala y chatbot Groq privado. Versión: " +
      VERSION
  );
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    sistema: "Servidor WebSocket Demo",
    version: VERSION,
    puerto: PORT,
    salas_guardadas: Object.keys(db.rooms || {}).length,
    mensajes_guardados: Array.isArray(db.messages) ? db.messages.length : 0
  });
});

app.get("/rooms", (req, res) => {
  res.json({
    ok: true,
    rooms: Object.values(db.rooms || {}).sort((a, b) =>
      String(b.lastActivity || "").localeCompare(String(a.lastActivity || ""))
    )
  });
});

function now() {
  return new Date().toISOString();
}

function cleanText(value, max = 300) {
  return String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .substring(0, max);
}

function sendTo(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function isChatClient(clientInfo) {
  return clientInfo && clientInfo.authenticated && clientInfo.mode === "chat";
}

function broadcastToRoom(room, data) {
  const safeRoom = cleanText(room, 30);
  if (!safeRoom) return;

  const payload = JSON.stringify({ ...data, room: safeRoom });

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === safeRoom &&
      isChatClient(clientInfo)
    ) {
      client.send(payload);
    }
  });
}

function getUsersInRoom(room) {
  const safeRoom = cleanText(room, 30);
  const users = [];

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === safeRoom &&
      clientInfo.username &&
      isChatClient(clientInfo)
    ) {
      users.push(clientInfo.username);
    }
  });

  return [...new Set(users)];
}

function broadcastUsers(room) {
  const safeRoom = cleanText(room, 30);
  if (!safeRoom) return;

  const payload = JSON.stringify({
    type: "users",
    room: safeRoom,
    users: getUsersInRoom(safeRoom)
  });

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === safeRoom &&
      isChatClient(clientInfo)
    ) {
      client.send(payload);
    }
  });
}

function touchRoom(room, username = "") {
  const safeRoom = cleanText(room, 30) || "general";
  const safeUser = cleanText(username, 24);

  const current = db.rooms[safeRoom] || {
    room: safeRoom,
    createdAt: now(),
    lastActivity: now(),
    usersSeen: []
  };

  current.lastActivity = now();

  if (safeUser && !current.usersSeen.includes(safeUser)) {
    current.usersSeen.push(safeUser);
  }

  current.onlineUsers = getUsersInRoom(safeRoom);
  current.messageCount = db.messages.filter(
    (msg) => msg.room === safeRoom && msg.type === "message"
  ).length;

  if (current.usersSeen.length > 100) {
    current.usersSeen = current.usersSeen.slice(-100);
  }

  db.rooms[safeRoom] = current;
  saveDatabase();
}

function saveMessage(messageData) {
  db.messages.push(messageData);

  if (db.messages.length > 1500) {
    db.messages = db.messages.slice(db.messages.length - 1500);
  }

  touchRoom(messageData.room, messageData.user || "");
}

function getRoomHistory(room) {
  const safeRoom = cleanText(room, 30) || "general";

  return db.messages.filter((msg) => msg.room === safeRoom).slice(-60);
}

function createSystemMessage(room, text) {
  return {
    type: "system",
    room,
    text,
    time: now()
  };
}

function createUserMessage(room, user, text) {
  return {
    type: "message",
    room,
    user,
    text,
    time: now()
  };
}

function createBotMessage(room, text) {
  return {
    type: "bot",
    room,
    user: "🤖 Asistente",
    text,
    time: now()
  };
}

function sendHistory(ws, room) {
  sendTo(ws, {
    type: "history",
    room,
    messages: getRoomHistory(room)
  });
}

async function getGroqResponse(text, context = {}) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return "No tengo configurada la API key de Groq en el servidor. Agrega la variable GROQ_API_KEY en OpenShift para activar el asistente.";
  }

  const room = context.room || "general";
  const username = context.username || "Usuario";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "Eres un chatbot asistente dentro de un proyecto académico llamado WebSocket Demo. " +
            "Responde siempre en español. Sé claro, amable y útil. " +
            "Puedes responder preguntas generales del usuario, no solo del proyecto. " +
            "Si preguntan sobre el proyecto, explica WebSocket, salas, historial, base de datos, Node.js, OpenShift y chatbot. " +
            "No inventes datos privados. Si no sabes algo, dilo de manera natural."
        },
        {
          role: "user",
          content:
            "Usuario actual: " +
            username +
            "\n" +
            "Sala actual: " +
            room +
            "\n\n" +
            "Mensaje del usuario:\n" +
            text
        }
      ],
      temperature: 0.7,
      max_tokens: 350
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log("Error Groq:", errorText);

    if (response.status === 401) {
      return "La API key de Groq no es válida o no está configurada correctamente.";
    }

    if (response.status === 429) {
      return "Groq está limitando las solicitudes por ahora. Intenta nuevamente en unos segundos.";
    }

    return "Tuve un problema consultando la API de Groq. Revisa la API key, el modelo o la conexión del servidor.";
  }

  const data = await response.json();

  return (
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
  ) || "No recibí una respuesta válida del asistente.";
}

async function getBotResponse(text, context = {}) {
  try {
    return await getGroqResponse(text, context);
  } catch (error) {
    console.log("Error en getBotResponse:", error.message);
    return "Ocurrió un error al generar la respuesta del asistente.";
  }
}

function joinOrChangeRoom(ws, data, isChange = false) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const oldRoom = clientInfo.room;
  const oldMode = clientInfo.mode;

  const username =
    cleanText(data.username || clientInfo.username || "Invitado", 24) ||
    "Invitado";
  const room =
    cleanText(data.room || clientInfo.room || "general", 30) || "general";
  const mode = data.mode === "bot" ? "bot" : "chat";

  const movingRoom = oldRoom && oldRoom !== room;
  const changingMode = oldMode && oldMode !== mode;

  if ((movingRoom || changingMode) && oldRoom && oldMode === "chat") {
    const leaveMsg = createSystemMessage(
      oldRoom,
      `${clientInfo.username || username} salió de la sala ${oldRoom}.`
    );
    saveMessage(leaveMsg);
    broadcastToRoom(oldRoom, leaveMsg);
  }

  clientInfo.username = username;
  clientInfo.room = room;
  clientInfo.mode = mode;
  clientInfo.authenticated = true;
  clients.set(ws, clientInfo);

  touchRoom(room, username);

  sendTo(ws, {
    type: "joined",
    username,
    room,
    mode,
    version: VERSION,
    changed: Boolean(isChange)
  });

  if (mode === "chat") {
    sendHistory(ws, room);

    const joinText =
      isChange || movingRoom || changingMode
        ? `${username} entró a la sala ${room}.`
        : `${username} se unió a la sala ${room}.`;

    const joinMsg = createSystemMessage(room, joinText);
    saveMessage(joinMsg);
    broadcastToRoom(room, joinMsg);
  } else {
    sendTo(ws, {
      type: "botPrivate",
      text: "Modo Bot privado activado. Esta conversación no se envía a la sala."
    });
  }

  if (oldRoom && oldRoom !== room) {
    broadcastUsers(oldRoom);
    touchRoom(oldRoom);
  }

  broadcastUsers(room);
}

wss.on("connection", (ws) => {
  console.log("Cliente conectado");

  clients.set(ws, {
    username: "",
    room: "",
    mode: "chat",
    authenticated: false
  });

  sendTo(ws, {
    type: "system",
    text: "Conectado al servidor WebSocket.",
    version: VERSION
  });

  ws.on("message", async (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      sendTo(ws, {
        type: "system",
        text: "Mensaje inválido."
      });
      return;
    }

    const clientInfo = clients.get(ws);
    if (!clientInfo) return;

    if (data.type === "auth") {
      const password = String(data.password || "");

      if (password === "1234") {
        clientInfo.authenticated = true;
        clients.set(ws, clientInfo);

        sendTo(ws, {
          type: "authOk",
          text: "Autenticación correcta.",
          version: VERSION
        });
      } else {
        sendTo(ws, {
          type: "system",
          text: "Contraseña incorrecta."
        });
      }

      return;
    }

    if (!clientInfo.authenticated) {
      sendTo(ws, {
        type: "system",
        text: "Primero debes autenticarte."
      });
      return;
    }

    if (data.type === "join") {
      joinOrChangeRoom(ws, data, false);
      return;
    }

    if (data.type === "changeRoom") {
      joinOrChangeRoom(ws, data, true);
      return;
    }

    if (data.type === "message") {
      const text = cleanText(data.text, 500);
      if (text === "") return;

      if (!clientInfo.room || !clientInfo.username) {
        sendTo(ws, {
          type: "system",
          text: "Primero debes entrar a una sala."
        });
        return;
      }

      if (clientInfo.mode === "bot") {
        const privateUserMessage = createUserMessage(
          clientInfo.room,
          clientInfo.username,
          text
        );
        privateUserMessage.private = true;

        sendTo(ws, privateUserMessage);

        const botText = await getBotResponse(text, {
          username: clientInfo.username,
          room: clientInfo.room
        });

        const botMessage = createBotMessage(clientInfo.room, botText);
        botMessage.private = true;

        sendTo(ws, botMessage);
        return;
      }

      const userMessage = createUserMessage(
        clientInfo.room,
        clientInfo.username,
        text
      );
      saveMessage(userMessage);
      broadcastToRoom(clientInfo.room, userMessage);
      broadcastUsers(clientInfo.room);
      return;
    }

    if (data.type === "ping") {
      sendTo(ws, { type: "pong", time: now(), version: VERSION });
      return;
    }
  });

  ws.on("close", () => {
    const clientInfo = clients.get(ws);

    if (
      clientInfo &&
      clientInfo.room &&
      clientInfo.username &&
      clientInfo.authenticated &&
      clientInfo.mode === "chat"
    ) {
      const exitMessage = createSystemMessage(
        clientInfo.room,
        `${clientInfo.username} salió del chat.`
      );

      saveMessage(exitMessage);
      broadcastToRoom(clientInfo.room, exitMessage);
    }

    clients.delete(ws);

    if (clientInfo && clientInfo.room) {
      broadcastUsers(clientInfo.room);
      touchRoom(clientInfo.room);
    }

    console.log("Cliente desconectado");
  });

  ws.on("error", (error) => {
    console.log("Error WebSocket:", error.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor WebSocket Demo escuchando en puerto " + PORT);
  console.log("Versión:", VERSION);
});