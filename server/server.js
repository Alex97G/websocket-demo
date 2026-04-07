const http = require('http');
const WebSocket = require('ws');

const PORT = 8080;

// Servidor HTTP (para health check)
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', connections: wss.clients.size }));
  } else {
    res.writeHead(200);
    res.end("WebSocket server running");
  }
});

// Servidor WebSocket
const wss = new WebSocket.Server({ server });

let clientId = 0;

wss.on('connection', (ws) => {
  clientId++;
  ws.id = clientId;

  console.log(`Cliente ${ws.id} conectado`);

  // Mensaje de bienvenida
  ws.send(JSON.stringify({
    type: 'welcome',
    message: `Hola cliente ${ws.id}`
  }));

  // Cuando recibe mensaje
  ws.on('message', (message) => {
    console.log(`Mensaje de ${ws.id}: ${message}`);

    // Broadcast a todos
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'message',
          from: ws.id,
          text: message.toString()
        }));
      }
    });
  });

  // Cuando se desconecta
  ws.on('close', () => {
    console.log(`Cliente ${ws.id} desconectado`);

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'info',
          message: `Cliente ${ws.id} se desconectó`
        }));
      }
    });
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});