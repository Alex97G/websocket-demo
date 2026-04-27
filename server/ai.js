const axios = require("axios");

// 🤖 BOT PROFESOR / ASISTENTE
async function getAIResponse(message, context = "") {

  try {
    const response = await axios.post("http://localhost:11434/api/generate", {
      model: "llama3",
      prompt: `
Eres un PROFESOR y ASISTENTE TÉCNICO experto en:

- Programación
- Redes
- WebSockets
- OpenShift
- Desarrollo web

REGLAS:
- Explica paso a paso
- Usa ejemplos simples
- Si es técnico, responde como ingeniero
- Si el usuario está perdido, simplifica
- No respondas muy largo
- Usa listas cuando sea necesario
- Responde en español

CONTEXTO:
${context}

PREGUNTA DEL USUARIO:
${message}

RESPUESTA:
      `,
      stream: false
    });

    return response.data.response.trim();

  } catch (error) {
    console.log("Error IA:", error.message);
    return "Error en el asistente 🤖";
  }
}

module.exports = { getAIResponse };const axios = require("axios");

// 🤖 BOT PROFESOR / ASISTENTE
async function getAIResponse(message, context = "") {

  try {
    const response = await axios.post("http://localhost:11434/api/generate", {
      model: "llama3",
      prompt: `
Eres un PROFESOR y ASISTENTE TÉCNICO experto en:

- Programación
- Redes
- WebSockets
- OpenShift
- Desarrollo web

REGLAS:
- Explica paso a paso
- Usa ejemplos simples
- Si es técnico, responde como ingeniero
- Si el usuario está perdido, simplifica
- No respondas muy largo
- Usa listas cuando sea necesario
- Responde en español

CONTEXTO:
${context}

PREGUNTA DEL USUARIO:
${message}

RESPUESTA:
      `,
      stream: false
    });

    return response.data.response.trim();

  } catch (error) {
    console.log("Error IA:", error.message);
    return "Error en el asistente 🤖";
  }
}

module.exports = { getAIResponse };