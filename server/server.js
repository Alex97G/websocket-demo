const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const PASSWORD = "1234";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(200);
    res.end("WebSocket server running 🚀");
  }
});

const wss = new WebSocket.Server({ server });

const rooms = {};

wss.on("connection", (ws) => {

  ws.isAuth = false;

  ws.send(JSON.stringify({
    type: "system",
    text: "Conectado al servidor 🚀"
  }));

  ws.on("message", (msg) => {

    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
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

      ws.isAuth = true;

      ws.send(JSON.stringify({
        type: "system",
        text: "Acceso concedido ✅"
      }));

      return;
    }

    if (!ws.isAuth) return;

    // 👤 JOIN
    if (data.type === "join") {

      ws.username = data.username || "Anon";
      ws.mode = data.mode || "chat";
      ws.room = "general";

      if (!rooms[ws.room]) rooms[ws.room] = [];
      rooms[ws.room].push(ws);

      if (ws.mode === "chat") {
        broadcast(ws.room, {
          type: "system",
          text: `${ws.username} se unió 👋`
        });
      }

      return;
    }

    // 💬 MESSAGE
    if (data.type === "message") {

      // CHAT NORMAL
      if (ws.mode === "chat") {
        broadcast(ws.room, {
          type: "message",
          user: ws.username,
          text: data.text
        });
        return;
      }

      // BOT
      if (ws.mode === "bot") {

        const txt = data.text.toLowerCase();
        let reply = "No entendí 🤖";

        if (txt.includes("hola")) reply = "Hola 👋 soy tu asistente";
        else if (txt.includes("hora")) reply = new Date().toLocaleTimeString();
        else if (txt.includes("info")) reply = "WebSocket + OpenShift 🚀";
        else if (txt.includes("websocket")) reply = "Comunicación en tiempo real ⚡";

        ws.send(JSON.stringify({
          type: "bot",
          text: reply
        }));

        return;
      }
    }
  });

  ws.on("close", () => {

    if (ws.room && rooms[ws.room]) {
      rooms[ws.room] = rooms[ws.room].filter(c => c !== ws);

      if (ws.mode === "chat") {
        broadcast(ws.room, {
          type: "system",
          text: `${ws.username} salió ❌`
        });
      }
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