const axios = require("axios");

const API_KEY = process.env.OPENAI_API_KEY;

async function getAIResponse(message, context = "") {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Eres un PROFESOR y ASISTENTE TÉCNICO experto en:
- Programación
- Redes
- WebSockets
- OpenShift
- Desarrollo web

Explica claro, breve y con ejemplos simples.
            `
          },
          {
            role: "user",
            content: message
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.choices[0].message.content;

  } catch (error) {
    console.log("Error IA:", error.message);
    return "🤖 Error conectando a IA";
  }
}

module.exports = { getAIResponse };