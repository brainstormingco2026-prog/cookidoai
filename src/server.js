require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { generarReceta, adaptarReceta, leerRecetaDeFoto } = require('./openai');
const { crearRecetaEnCookidoo, iniciarSesionConCredenciales, extraerRecetaDeCookidoo, extraerPreviewReceta, getSessionFile } = require('./cookidoo');

function getPerfilDir(userId) {
  return path.join(__dirname, '..', `chrome-perfil-${userId}`);
}

// ── Usuarios estáticos de prueba ──────────────────────────────────────────────
const USERS = [
  { id: '1', nombre: 'Usuario UAT 1', email: 'uat1@cookidoai.com', password: 'uat2025' },
  { id: '2', nombre: 'Usuario UAT 2', email: 'uat2@cookidoai.com', password: 'uat2025' },
];

const LIMITE_RECETAS = 10;
const contadorRecetas = {}; // { userId: número de recetas creadas }

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cookidoai-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 días
}));

// ── Auth routes (sin protección) ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Completa todos los campos' });

  const user = USERS.find(u => u.email === email.toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  req.session.userId = user.id;
  req.session.nombre = user.nombre;
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  const user = USERS.find(u => u.id === req.session.userId);
  res.json({ id: req.session.userId, nombre: req.session.nombre, email: user?.email || '' });
});

// ── Middleware de autenticación ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
  res.redirect('/login');
}

// Archivos estáticos públicos (login.html, css, etc.)
// HTML y JS sin caché para que el browser siempre pida la versión más reciente
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Ruta raíz protegida
app.get('/', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Proteger todas las rutas /api/* excepto auth y SSE
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/eventos') return next(); // SSE: solo recibe broadcast, no datos sensibles
  requireAuth(req, res, next);
});

// ── Estado de la sesión (en memoria) ─────────────────────────────────────────
let estadoActual = { receta: null, estado: 'idle' };
const clientes = new Set();

// ── SSE ───────────────────────────────────────────────────────────────────────
app.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
    if (res.flush) res.flush();
  }, 15000);

  clientes.add(res);
  req.on('close', () => { clearInterval(heartbeat); clientes.delete(res); });
});

function emitirEvento(tipo, datos) {
  const payload = JSON.stringify({ tipo, ...datos });
  for (const res of clientes) {
    res.write(`data: ${payload}\n\n`);
    if (res.flush) res.flush();
  }
}

// ── API routes ────────────────────────────────────────────────────────────────

// POST /api/generar
app.post('/api/generar', async (req, res) => {
  const { descripcion, detalles } = req.body;
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Escribe qué receta quieres generar' });

  estadoActual = { receta: null, estado: 'generando' };
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

function getEmailFile(userId) {
  return path.join(__dirname, '..', `cookido-email-${userId}.txt`);
}

function leerEmailGuardado(userId) {
  try { return fs.readFileSync(getEmailFile(userId), 'utf8').trim(); } catch { return null; }
}

// GET /api/sesion
app.get('/api/sesion', (req, res) => {
  const activa = fs.existsSync(getSessionFile(req.session.userId));
  res.json({ activa, email: activa ? leerEmailGuardado(req.session.userId) : null });
});

// POST /api/cerrar-sesion
app.post('/api/cerrar-sesion', (req, res) => {
  const sf = getSessionFile(req.session.userId);
  const ef = getEmailFile(req.session.userId);
  if (fs.existsSync(sf)) fs.unlinkSync(sf);
  if (fs.existsSync(ef)) fs.unlinkSync(ef);
  res.json({ ok: true });
});

// POST /api/login-manual
app.post('/api/login-manual', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const userId = req.session.userId;
  res.json({ ok: true });

  iniciarSesionConCredenciales(email, password, (msg) => {
    emitirEvento('progreso', { mensaje: msg });
  }, userId)
    .then(() => {
      fs.writeFileSync(getEmailFile(userId), email);
      emitirEvento('sesion-guardada', { mensaje: 'Sesión guardada.', email });
    })
    .catch((err) => emitirEvento('error', { mensaje: err.message }));
});

// GET /api/preview-receta
app.get('/api/preview-receta', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  try {
    const preview = await extraerPreviewReceta(url, req.session.userId);
    res.json({ ok: true, preview });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `No se pudo cargar la receta: ${err.message}` });
  }
});

// POST /api/adaptar
app.post('/api/adaptar', async (req, res) => {
  const { url, detalles } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  try {
    const contenido = await extraerRecetaDeCookidoo(url, null, req.session.userId);
    const receta = await adaptarReceta(contenido, (detalles || '').trim());
    res.json({ ok: true, receta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al adaptar receta: ${err.message}` });
  }
});

// POST /api/foto
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

// GET /api/imagen?q=...
app.get('/api/imagen', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query requerida' });
  if (!process.env.PEXELS_API_KEY) return res.status(503).json({ error: 'PEXELS_API_KEY no configurada' });

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q + ' food')}&per_page=1&orientation=landscape`;
    const r = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
    const datos = await r.json();
    const foto = datos.photos?.[0];
    if (!foto) return res.json({ imagen: null });
    res.json({ imagen: foto.src.large, autor: foto.photographer, autorUrl: foto.photographer_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crear
app.post('/api/crear', async (req, res) => {
  const { receta } = req.body;
  if (!receta) return res.status(400).json({ error: 'No hay receta para crear' });

  const userId = req.session.userId;
  const sinLimite = new Set(['2']); // usuarios sin restricción de recetas
  const usadas = contadorRecetas[userId] || 0;
  if (!sinLimite.has(userId) && usadas >= LIMITE_RECETAS) {
    return res.status(403).json({ error: `Límite de ${LIMITE_RECETAS} recetas alcanzado para este usuario de prueba.` });
  }

  estadoActual.estado = 'creando';
  res.json({ ok: true });

  crearRecetaEnCookidoo(receta, {}, (msg) => {
    emitirEvento('progreso', { mensaje: msg });
  }, req.session.userId)
    .then((resultado) => {
      contadorRecetas[userId] = (contadorRecetas[userId] || 0) + 1;
      estadoActual.estado = 'completado';
      emitirEvento('completado', { mensaje: '¡Receta creada en Cookidoo!', url: resultado?.url || null });
    })
    .catch((err) => {
      estadoActual.estado = 'error';
      emitirEvento('error', { mensaje: err.message });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✅ App corriendo en http://localhost:${PORT}\n`));
