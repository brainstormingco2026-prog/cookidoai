const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generarReceta(descripcion) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Eres un chef experto en cocina española y recetas para Thermomix.
Devuelve SIEMPRE un JSON con esta estructura exacta:
{
  "titulo": "Nombre de la receta",
  "descripcion": "Descripción breve apetitosa",
  "porciones": 4,
  "tiempo_preparacion": 15,
  "tiempo_coccion": 30,
  "dificultad": "fácil|media|difícil",
  "ingredientes": [
    { "cantidad": "200", "unidad": "g", "nombre": "harina" },
    { "cantidad": "2", "unidad": "unidades", "nombre": "huevos" }
  ],
  "pasos": [
    "descripción detallada del paso, sin prefijo Paso 1",
    "descripción detallada del paso, sin prefijo Paso 2"
  ]
}
Adapta las instrucciones para Thermomix cuando sea posible (velocidades, temperaturas, tiempos).`,
      },
      {
        role: 'user',
        content: `Crea una receta para: ${descripcion}`,
      },
    ],
  });

  const texto = completion.choices[0].message.content;
  return JSON.parse(texto);
}

module.exports = { generarReceta };
