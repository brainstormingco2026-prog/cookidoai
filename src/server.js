require('dotenv').config();
const express = require('express');
const path = require('path');
const { generarReceta } = require('./openai');
const { crearRecetaEnCookidoo, iniciarSesionManual } = require('./cookidoo');
const fs = require('fs');
const PERFIL_DIR = path.join(__dirname, '..', 'chrome-perfil');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado de la sesión (en memoria, una receta a la vez)
let estadoActual = { receta: null, estado: 'idle' };
const clientes = new Set(); // SSE clients para actualizaciones en tiempo real

// SSE: stream de actualizaciones al frontend
app.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Heartbeat cada 15s para mantener la conexión viva
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
    if (res.flush) res.flush();
  }, 15000);

  clientes.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    clientes.delete(res);
  });
});

function emitirEvento(tipo, datos) {
  const payload = JSON.stringify({ tipo, ...datos });
  for (const res of clientes) {
    res.write(`data: ${payload}\n\n`);
    if (res.flush) res.flush();
  }
}

// POST /api/generar — genera receta con ChatGPT
app.post('/api/generar', async (req, res) => {
  const { descripcion } = req.body;
  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ error: 'Escribe qué receta quieres generar' });
  }

  estadoActual = { receta: null, estado: 'generando' };
  emitirEvento('estado', { mensaje: 'Generando receta con ChatGPT...' });

  try {
    const receta = await generarReceta(descripcion.trim());
    estadoActual = { receta, estado: 'lista' };
    res.json({ ok: true, receta });
  } catch (err) {
    estadoActual.estado = 'idle';
    console.error(err);
    res.status(500).json({ error: `Error al generar receta: ${err.message}` });
  }
});

// GET /api/sesion — indica si hay sesión guardada
app.get('/api/sesion', (req, res) => {
  res.json({ activa: fs.existsSync(PERFIL_DIR) });
});

// POST /api/cerrar-sesion — borra el perfil de Chrome guardado
app.post('/api/cerrar-sesion', (req, res) => {
  if (fs.existsSync(PERFIL_DIR)) fs.rmSync(PERFIL_DIR, { recursive: true, force: true });
  res.json({ ok: true });
});

// POST /api/login-manual — abre navegador para que el usuario haga login
app.post('/api/login-manual', async (req, res) => {
  res.json({ ok: true, mensaje: 'Abriendo navegador... inicia sesión en Cookidoo y la app continuará automáticamente' });

  iniciarSesionManual((msg) => {
    emitirEvento('progreso', { mensaje: msg });
  })
    .then(() => emitirEvento('sesion-guardada', { mensaje: 'Sesión guardada. Ya puedes crear recetas.' }))
    .catch((err) => emitirEvento('error', { mensaje: err.message }));
});

// POST /api/crear — crea la receta en Cookidoo
app.post('/api/crear', async (req, res) => {
  const { receta } = req.body;

  if (!receta) return res.status(400).json({ error: 'No hay receta para crear' });

  estadoActual.estado = 'creando';
  res.json({ ok: true, mensaje: 'Iniciando Playwright... mira el navegador que se abrirá' });

  // Ejecutar en background y emitir eventos SSE
  crearRecetaEnCookidoo(receta, {}, (msg) => {
    emitirEvento('progreso', { mensaje: msg });
  })
    .then((resultado) => {
      estadoActual.estado = 'completado';
      emitirEvento('completado', { mensaje: '¡Receta creada en Cookidoo!', url: resultado?.url || null });
    })
    .catch((err) => {
      estadoActual.estado = 'error';
      emitirEvento('error', { mensaje: err.message });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ App corriendo en http://localhost:${PORT}\n`);
});
