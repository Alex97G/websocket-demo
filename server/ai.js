const axios = require("axios");

const API_KEY = process.env.GEMINI_API_KEY;

async function getAIResponse(message, context = "") {

  if (!API_KEY) {
    return "🤖 Falta API KEY de Gemini";
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
Eres un PROFESOR y ASISTENTE TÉCNICO experto en:
- Programación
- Redes
- WebSockets
- OpenShift
- Desarrollo web

CONTEXTO:
${context}

PREGUNTA:
${message}

Responde claro y breve.
                `
              }
            ]
          }
        ]
      }
    );

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "Sin respuesta 🤖";

  } catch (error) {
    console.log("Error IA:", error.response?.data || error.message);

    return "🤖 Error conectando con Google AI";
  }
}

module.exports = { getAIResponse };