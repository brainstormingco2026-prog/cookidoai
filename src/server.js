require('dotenv').config();
const express = require('express');
const path = require('path');
const { generarReceta, adaptarReceta, leerRecetaDeFoto } = require('./openai');
const { crearRecetaEnCookidoo, iniciarSesionConCredenciales, extraerRecetaDeCookidoo } = require('./cookidoo');
const fs = require('fs');
const PERFIL_DIR = path.join(__dirname, '..', 'chrome-perfil');

const app = express();
app.use(express.json({ limit: '15mb' }));
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
  const { descripcion, detalles } = req.body;
  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ error: 'Escribe qué receta quieres generar' });
  }

  estadoActual = { receta: null, estado: 'generando' };
  emitirEvento('estado', { mensaje: 'Generando receta con ChatGPT...' });

  try {
    const receta = await generarReceta(descripcion.trim(), (detalles || '').trim());
    estadoActual = { receta, estado: 'lista' };
    res.json({ ok: true, receta });
  } catch (err) {
    estadoActual.estado = 'idle';
    console.error(err);
    res.status(500).json({ error: `Error al generar receta: ${err.message}` });
  }
});

const EMAIL_FILE = path.join(PERFIL_DIR, '.email');

function leerEmailGuardado() {
  try { return fs.readFileSync(EMAIL_FILE, 'utf8').trim(); } catch { return null; }
}

// GET /api/sesion — indica si hay sesión guardada y el email
app.get('/api/sesion', (req, res) => {
  const activa = fs.existsSync(PERFIL_DIR);
  res.json({ activa, email: activa ? leerEmailGuardado() : null });
});

// POST /api/cerrar-sesion — borra el perfil de Chrome guardado
app.post('/api/cerrar-sesion', (req, res) => {
  if (fs.existsSync(PERFIL_DIR)) fs.rmSync(PERFIL_DIR, { recursive: true, force: true });
  res.json({ ok: true });
});

// POST /api/login-manual — login con credenciales
app.post('/api/login-manual', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  res.json({ ok: true });

  iniciarSesionConCredenciales(email, password, (msg) => {
    emitirEvento('progreso', { mensaje: msg });
  })
    .then(() => {
      if (fs.existsSync(PERFIL_DIR)) fs.writeFileSync(EMAIL_FILE, email);
      emitirEvento('sesion-guardada', { mensaje: 'Sesión guardada. Ya puedes crear recetas.', email });
    })
    .catch((err) => emitirEvento('error', { mensaje: err.message }));
});

// POST /api/adaptar — extrae receta de una URL y la adapta con OpenAI
app.post('/api/adaptar', async (req, res) => {
  const { url, detalles } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  try {
    const contenido = await extraerRecetaDeCookidoo(url);
    const receta = await adaptarReceta(contenido, (detalles || '').trim());
    res.json({ ok: true, receta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al adaptar receta: ${err.message}` });
  }
});

// POST /api/foto — lee receta desde imagen (GPT-4o Vision) o PDF (pdf-parse + OpenAI)
app.post('/api/foto', async (req, res) => {
  const { imagen, tipo, detalles } = req.body;
  if (!imagen) return res.status(400).json({ error: 'Archivo requerido' });

  try {
    let receta;
    if (tipo === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = Buffer.from(imagen, 'base64');
      const { text } = await pdfParse(buffer);
      if (!text.trim()) throw new Error('No se pudo extraer texto del PDF');
      const { adaptarReceta } = require('./openai');
      receta = await adaptarReceta(text, (detalles || '').trim());
    } else {
      receta = await leerRecetaDeFoto(imagen, tipo || 'image/jpeg', (detalles || '').trim());
    }
    res.json({ ok: true, receta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al procesar el archivo: ${err.message}` });
  }
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
