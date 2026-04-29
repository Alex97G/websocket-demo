const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB_FILE = path.join(__dirname, "messages-db.json");

let clients = new Map();

// ==========================
// BASE DE DATOS SIMPLE JSON
// ==========================

function loadDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ messages: [] }, null, 2));
    }

    const content = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.log("Error cargando base de datos:", error.message);
    return { messages: [] };
  }
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.log("Error guardando base de datos:", error.message);
  }
}

let db = loadDatabase();

// ==========================
// RUTA HTTP DE PRUEBA
// ==========================

app.get("/", (req, res) => {
  res.send("Servidor WebSocket Demo activo con salas, historial y chatbot Groq privado.");
});

// ==========================
// UTILIDADES
// ==========================

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
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data) {
  const message = JSON.stringify(data);

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === room &&
      clientInfo.authenticated &&
      clientInfo.mode === "chat"
    ) {
      client.send(message);
    }
  });
}

function getUsersInRoom(room) {
  const users = [];

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === room &&
      clientInfo.username &&
      clientInfo.authenticated
    ) {
      if (!users.includes(clientInfo.username)) {
        users.push(clientInfo.username);
      }
    }
  });

  return users;
}

function broadcastUsers(room) {
  if (!room) return;

  const payload = {
    type: "users",
    users: getUsersInRoom(room)
  };

  const message = JSON.stringify(payload);

  clients.forEach((clientInfo, client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientInfo.room === room &&
      clientInfo.authenticated
    ) {
      client.send(message);
    }
  });
}

function saveMessage(messageData) {
  db.messages.push(messageData);

  if (db.messages.length > 1500) {
    db.messages = db.messages.slice(db.messages.length - 1500);
  }

  saveDatabase(db);
}

function getRoomHistory(room) {
  return db.messages
    .filter((msg) => msg.room === room)
    .slice(-60);
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

// ==========================
// CHATBOT CON GROQ
// ==========================

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
      "Authorization": "Bearer " + apiKey,
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
            "Usuario actual: " + username + "\n" +
            "Sala actual: " + room + "\n\n" +
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

// ==========================
// WEBSOCKET
// ==========================

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
    text: "Conectado al servidor WebSocket."
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

    // ==========================
    // AUTENTICACIÓN BÁSICA
    // ==========================

    if (data.type === "auth") {
      const password = String(data.password || "");

      if (password === "1234") {
        clientInfo.authenticated = true;
        clients.set(ws, clientInfo);

        sendTo(ws, {
          type: "system",
          text: "Autenticación correcta."
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

    // ==========================
    // ENTRAR A SALA / MODO
    // ==========================

    if (data.type === "join") {
      const oldRoom = clientInfo.room;

      const username = cleanText(data.username || "Invitado", 24);
      const room = cleanText(data.room || "general", 30);
      const mode = data.mode === "bot" ? "bot" : "chat";

      clientInfo.username = username || "Invitado";
      clientInfo.room = room || "general";
      clientInfo.mode = mode;

      clients.set(ws, clientInfo);

      sendTo(ws, {
        type: "joined",
        username: clientInfo.username,
        room: clientInfo.room,
        mode: clientInfo.mode
      });

      if (clientInfo.mode === "chat") {
        sendTo(ws, {
          type: "history",
          room: clientInfo.room,
          messages: getRoomHistory(clientInfo.room)
        });

        const joinMsg = createSystemMessage(
          clientInfo.room,
          `${clientInfo.username} se unió a la sala ${clientInfo.room}.`
        );

        saveMessage(joinMsg);
        broadcastToRoom(clientInfo.room, joinMsg);
      } else {
        sendTo(ws, {
          type: "botPrivate",
          text: "Modo Bot privado activado. Esta conversación no se envía a la sala."
        });
      }

      if (oldRoom && oldRoom !== clientInfo.room) {
        broadcastUsers(oldRoom);
      }

      broadcastUsers(clientInfo.room);
      return;
    }

    // ==========================
    // MENSAJES
    // ==========================

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

      // MODO BOT PRIVADO
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

      // MODO CHAT NORMAL
      const userMessage = createUserMessage(
        clientInfo.room,
        clientInfo.username,
        text
      );

      saveMessage(userMessage);
      broadcastToRoom(clientInfo.room, userMessage);

      return;
    }

    // ==========================
    // CAMBIAR DE SALA
    // ==========================

    if (data.type === "changeRoom") {
      const oldRoom = clientInfo.room;
      const newRoom = cleanText(data.room || "general", 30);

      if (!newRoom) return;

      if (oldRoom && clientInfo.mode === "chat") {
        const leaveOld = createSystemMessage(
          oldRoom,
          `${clientInfo.username} cambió de sala.`
        );

        saveMessage(leaveOld);
        broadcastToRoom(oldRoom, leaveOld);
      }

      clientInfo.room = newRoom;
      clients.set(ws, clientInfo);

      sendTo(ws, {
        type: "joined",
        username: clientInfo.username,
        room: newRoom,
        mode: clientInfo.mode
      });

      if (clientInfo.mode === "chat") {
        sendTo(ws, {
          type: "history",
          room: newRoom,
          messages: getRoomHistory(newRoom)
        });

        const changeMsg = createSystemMessage(
          newRoom,
          `${clientInfo.username} entró a la sala ${newRoom}.`
        );

        saveMessage(changeMsg);
        broadcastToRoom(newRoom, changeMsg);
      } else {
        sendTo(ws, {
          type: "botPrivate",
          text: "Modo Bot privado activado en la nueva sala."
        });
      }

      if (oldRoom) broadcastUsers(oldRoom);
      broadcastUsers(newRoom);
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
    }

    console.log("Cliente desconectado");
  });

  ws.on("error", (error) => {
    console.log("Error WebSocket:", error.message);
  });
});

// ==========================
// INICIAR SERVIDOR
// ==========================

server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor WebSocket Demo escuchando en puerto " + PORT);
});