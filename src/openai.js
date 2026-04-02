const OpenAI = require('openai');

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

async function generarReceta(descripcion, detalles = '') {
  const completion = await getClient().chat.completions.create({
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
  "imagen_busqueda": "2-4 English keywords describing the finished dish for a food photo search (e.g. 'creamy rice pudding cinnamon')",
  "ingredientes": [
    { "cantidad": "200", "unidad": "g", "nombre": "harina" },
    { "cantidad": "2", "unidad": "unidades", "nombre": "huevos" }
  ],
  "pasos": [
    "descripción detallada del paso, sin prefijo Paso 1",
    "descripción detallada del paso, sin prefijo Paso 2"
  ]
}
Adapta las instrucciones para Thermomix cuando sea posible (velocidades, temperaturas, tiempos).
IMPORTANTE: El campo imagen_busqueda SIEMPRE debe estar en inglés, nunca en español. Son keywords para buscar fotos del plato terminado.`,
      },
      {
        role: 'user',
        content: detalles
          ? `Crea una receta para: ${descripcion}\n\nEspecificaciones adicionales: ${detalles}`
          : `Crea una receta para: ${descripcion}`,
      },
    ],
  });

  const texto = completion.choices[0].message.content;
  return JSON.parse(texto);
}

async function adaptarReceta(contenidoOriginal, detalles = '') {
  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Eres un chef experto en cocina española y recetas para Thermomix.
Recibirás el contenido de una receta existente. Tu tarea es adaptarla para Thermomix.
Devuelve SIEMPRE un JSON con esta estructura exacta:
{
  "titulo": "Nombre de la receta",
  "descripcion": "Descripción breve apetitosa",
  "porciones": 4,
  "tiempo_preparacion": 15,
  "tiempo_coccion": 30,
  "dificultad": "fácil|media|difícil",
  "imagen_busqueda": "2-4 English keywords describing the finished dish for a food photo search (e.g. 'garlic shrimp pasta')",
  "ingredientes": [
    { "cantidad": "200", "unidad": "g", "nombre": "harina" }
  ],
  "pasos": [
    "descripción detallada del paso adaptado para Thermomix, sin prefijo Paso 1"
  ]
}
Adapta tiempos, temperaturas y velocidades para Thermomix. Mantén los ingredientes originales salvo que se indique lo contrario.
IMPORTANTE: El campo imagen_busqueda SIEMPRE debe estar en inglés, nunca en español. Son keywords para buscar fotos del plato terminado.`,
      },
      {
        role: 'user',
        content: detalles
          ? `Adapta esta receta para Thermomix:\n\n${contenidoOriginal}\n\nInstrucciones adicionales: ${detalles}`
          : `Adapta esta receta para Thermomix:\n\n${contenidoOriginal}`,
      },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

async function leerRecetaDeFoto(base64, mimeType, detalles = '') {
  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Eres un chef experto en cocina española y recetas para Thermomix.
Recibirás la foto de una receta. Extrae todos los datos y adáptala para Thermomix.
Devuelve SIEMPRE un JSON con esta estructura exacta:
{
  "titulo": "Nombre de la receta",
  "descripcion": "Descripción breve apetitosa",
  "porciones": 4,
  "tiempo_preparacion": 15,
  "tiempo_coccion": 30,
  "dificultad": "fácil|media|difícil",
  "imagen_busqueda": "2-4 English keywords describing the finished dish for a food photo search (e.g. 'chocolate lava cake dessert')",
  "ingredientes": [
    { "cantidad": "200", "unidad": "g", "nombre": "harina" }
  ],
  "pasos": [
    "descripción detallada del paso adaptado para Thermomix, sin prefijo Paso 1"
  ]
}
Si algo no está claro en la imagen, usa tu criterio como chef.
IMPORTANTE: El campo imagen_busqueda SIEMPRE debe estar en inglés, nunca en español. Son keywords para buscar fotos del plato terminado.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: 'text',
            text: detalles
              ? `Lee esta receta y adáptala para Thermomix. Instrucciones adicionales: ${detalles}`
              : 'Lee esta receta y adáptala para Thermomix.',
          },
        ],
      },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

module.exports = { generarReceta, adaptarReceta, leerRecetaDeFoto };
