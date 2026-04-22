const http = require("http");
const WebSocket = require("ws");

const PORT = 8080;
const PASSWORD = "1234"; // 🔐 clave de acceso

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
  ws.send(JSON.stringify({ type: "system", text: "Conectado al servidor 🚀" }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    // 🔐 Validar clave
    if (data.type === "auth") {
      if (data.password !== PASSWORD) {
        ws.send(JSON.stringify({ type: "error", text: "Clave incorrecta ❌" }));
        ws.close();
      } else {
        ws.send(JSON.stringify({ type: "system", text: "Acceso concedido ✅" }));
      }
    }

    // 👤 Unirse a sala
    if (data.type === "join") {
      ws.username = data.username;
      ws.room = data.room;

      if (!rooms[data.room]) rooms[data.room] = [];
      rooms[data.room].push(ws);

      broadcast(ws.room, {
        type: "system",
        text: `${ws.username} se unió 👋`,
      });
    }

    // 💬 Mensaje normal
    if (data.type === "message") {
      const message = {
        type: "message",
        user: ws.username,
        text: data.text,
      };

      broadcast(ws.room, message);

      // 🤖 BOT
      const txt = data.text.toLowerCase();

      if (txt.includes("hola")) {
        ws.send(JSON.stringify({ type: "bot", text: "Hola 👋 ¿Cómo estás?" }));
      }

      if (txt.includes("hora")) {
        ws.send(JSON.stringify({
          type: "bot",
          text: "🕒 Son las " + new Date().toLocaleTimeString()
        }));
      }

      if (txt.includes("info")) {
        ws.send(JSON.stringify({
          type: "bot",
          text: "Soy un bot en WebSocket desplegado en OpenShift 🚀"
        }));
      }

      if (txt.includes("ayuda")) {
        ws.send(JSON.stringify({
          type: "bot",
          text: "Comandos: hola, hora, info"
        }));
      }
    }

    ws.on("close", () => {
      if (ws.room && rooms[ws.room]) {
        rooms[ws.room] = rooms[ws.room].filter(c => c !== ws);
        broadcast(ws.room, {
          type: "system",
          text: `${ws.username} salió ❌`,
        });
      }
    });
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