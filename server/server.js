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

app.get("/", (req, res) => {
  res.send("Servidor WebSocket Demo activo con salas, chatbot, historial y notificaciones.");
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
      clientInfo.authenticated
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
  broadcastToRoom(room, {
    type: "users",
    users: getUsersInRoom(room)
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

function getBotResponse(text) {
  const msg = text.toLowerCase();

  if (msg.includes("hola") || msg.includes("buenas")) {
    return "Hola 👋 Soy el asistente del chat. Puedes preguntarme sobre WebSocket, salas, historial o notificaciones.";
  }

  if (msg.includes("websocket") || msg.includes("web socket")) {
    return "WebSocket permite una comunicación bidireccional y persistente entre cliente y servidor. A diferencia de HTTP tradicional, la conexión queda abierta y el servidor puede enviar datos en tiempo real.";
  }

  if (msg.includes("sala") || msg.includes("salas")) {
    return "Las salas separan las conversaciones. Cada usuario recibe únicamente los mensajes de la sala en la que está conectado.";
  }

  if (msg.includes("historial") || msg.includes("base de datos") || msg.includes("guardar")) {
    return "El historial se guarda en un archivo JSON que funciona como base de datos simple. Cuando un usuario entra a una sala, el servidor consulta los últimos mensajes y los envía automáticamente.";
  }

  if (msg.includes("notificacion") || msg.includes("notificaciones")) {
    return "Las notificaciones del navegador avisan cuando llega un mensaje nuevo mientras el usuario no está mirando la pestaña.";
  }

  if (msg.includes("node") || msg.includes("node.js")) {
    return "Node.js se usa para ejecutar el servidor WebSocket. En este proyecto recibe mensajes, gestiona salas, guarda historial y responde con el chatbot.";
  }

  if (msg.includes("openshift")) {
    return "OpenShift permite desplegar el cliente y el servidor en la nube para que el chat funcione desde diferentes dispositivos conectados a internet.";
  }

  if (msg.includes("ayuda")) {
    return "Puedes usar el modo Chat para hablar con otros usuarios o el modo Bot para hacer preguntas. También puedes probar: websocket, salas, historial, notificaciones, Node.js u OpenShift.";
  }

  return "Soy el asistente del sistema 🤖. Puedes preguntarme sobre WebSocket, salas, historial, base de datos, notificaciones, Node.js u OpenShift.";
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
    text: "Conectado al servidor WebSocket."
  });

  ws.on("message", (message) => {
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

    // Compatible con tu index.html actual
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

    if (data.type === "join") {
      const oldRoom = clientInfo.room;

      const username = cleanText(data.username || data.name || "Invitado", 24);
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

      if (oldRoom && oldRoom !== clientInfo.room) {
        broadcastUsers(oldRoom);
      }

      broadcastUsers(clientInfo.room);
      return;
    }

    if (data.type === "message") {
      const text = cleanText(data.text || data.message, 500);

      if (text === "") return;

      if (!clientInfo.room || !clientInfo.username) {
        sendTo(ws, {
          type: "system",
          text: "Primero debes entrar a una sala."
        });
        return;
      }

      const userMessage = createUserMessage(
        clientInfo.room,
        clientInfo.username,
        text
      );

      saveMessage(userMessage);
      broadcastToRoom(clientInfo.room, userMessage);

      const shouldBotReply =
        clientInfo.mode === "bot" ||
        text.toLowerCase().startsWith("/bot") ||
        text.toLowerCase().includes("@bot");

      if (shouldBotReply) {
        const cleanQuestion = text
          .replace("/bot", "")
          .replace("@bot", "")
          .trim();

        const botText = getBotResponse(cleanQuestion || text);
        const botMessage = createBotMessage(clientInfo.room, botText);

        setTimeout(() => {
          saveMessage(botMessage);
          broadcastToRoom(clientInfo.room, botMessage);
        }, 450);
      }

      return;
    }

    if (data.type === "changeRoom") {
      const oldRoom = clientInfo.room;
      const newRoom = cleanText(data.room || "general", 30);

      if (!newRoom) return;

      if (oldRoom) {
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

      if (oldRoom) broadcastUsers(oldRoom);
      broadcastUsers(newRoom);
      return;
    }

    if (data.type === "typing") {
      broadcastToRoom(clientInfo.room, {
        type: "typing",
        user: clientInfo.username
      });
      return;
    }
  });

  ws.on("close", () => {
    const clientInfo = clients.get(ws);

    if (clientInfo && clientInfo.room && clientInfo.username) {
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

server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor WebSocket Demo escuchando en puerto " + PORT);
});