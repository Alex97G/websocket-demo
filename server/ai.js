const axios = require("axios");

const API_KEY = process.env.GROQ_API_KEY;

async function getAIResponse(message, context = "") {

  if (!API_KEY) {
    return "🤖 Falta API KEY de Groq";
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
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

CONTEXTO:
${context}

Responde claro y breve.
            `
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 1000
      },
      {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data?.choices?.[0]?.message?.content || "Sin respuesta 🤖";

  } catch (error) {
    console.log("Error IA:", error.response?.data || error.message);
    return "🤖 Error conectando con Groq";
  }
}

module.exports = { getAIResponse };