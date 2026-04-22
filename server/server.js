const http = require("http");
const WebSocket = require("ws");

const PORT = 8080;
const PASSWORD = "1234";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(200);
    res.end("WebSocket server running");
  }
});

const wss = new WebSocket.Server({ server });

const rooms = {};

wss.on("connection", (ws) => {

  ws.send(JSON.stringify({
    type: "system",
    text: "Conectado al servidor 🚀"
  }));

  ws.on("message", (msg) => {

    // 🔥 AQUÍ ESTÁ LA CLAVE
    let data;
    try {
      data = JSON.parse(msg.toString()); // 👈 convertir Buffer a string
    } catch (err) {
      console.log("Error parseando:", msg.toString());
      return;
    }

    // 🔐 AUTH
    if (data.type === "auth") {
      if (data.password !== PASSWORD) {
        ws.send(JSON.stringify({
          type: "error",
          text: "Clave incorrecta ❌"
        }));
        return ws.close();
      }

      ws.send(JSON.stringify({
        type: "system",
        text: "Acceso concedido ✅"
      }));
    }

    // 👤 JOIN
    if (data.type === "join") {
      ws.username = data.username;
      ws.room = data.room;

      if (!rooms[ws.room]) rooms[ws.room] = [];
      rooms[ws.room].push(ws);

      broadcast(ws.room, {
        type: "system",
        text: `${ws.username} se unió 👋`
      });
    }

    // 💬 MENSAJES
    if (data.type === "message") {
      broadcast(ws.room, {
        type: "message",
        user: ws.username,
        text: data.text
      });

      // 🤖 BOT
      const txt = data.text.toLowerCase();

      if (txt.includes("hola")) {
        ws.send(JSON.stringify({
          type: "bot",
          text: "Hola 👋"
        }));
      }

      if (txt.includes("hora")) {
        ws.send(JSON.stringify({
          type: "bot",
          text: "Son las " + new Date().toLocaleTimeString()
        }));
      }
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room] = rooms[ws.room].filter(c => c !== ws);

      broadcast(ws.room, {
        type: "system",
        text: `${ws.username} salió ❌`
      });
    }
  });
});

function broadcast(room, message) {
  if (!rooms[room]) return;

  rooms[room].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

server.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});