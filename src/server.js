require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { generarReceta, adaptarReceta, leerRecetaDeFoto } = require('./openai');
const { crearRecetaEnCookidoo, iniciarSesionConCredenciales, extraerRecetaDeCookidoo } = require('./cookidoo');
const { pool, inicializarDB } = require('./db');

const PERFIL_DIR = path.join(__dirname, '..', 'chrome-perfil');

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

app.post('/api/auth/register', async (req, res) => {
  const { nombre, email, password } = req.body || {};
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Completa todos los campos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  try {
    const existe = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (nombre, email, password) VALUES ($1, $2, $3) RETURNING id, nombre',
      [nombre, email.toLowerCase(), hash]
    );
    const user = result.rows[0];

    req.session.userId = String(user.id);
    req.session.nombre = user.nombre;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear cuenta' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Completa todos los campos' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    req.session.userId = String(user.id);
    req.session.nombre = user.nombre;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    res.json({ id: req.session.userId, nombre: req.session.nombre, email: user?.email || '' });
  } catch (err) {
    console.error(err);
    res.json({ id: req.session.userId, nombre: req.session.nombre, email: '' });
  }
});

// ── Middleware de autenticación ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  // DB deshabilitada: acceso libre
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('host')) return next();
  if (req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
  res.redirect('/login');
}

// Archivos estáticos públicos (login.html, css, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta raíz protegida
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Proteger todas las rutas /api/* excepto las de auth
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
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

const EMAIL_FILE = path.join(PERFIL_DIR, '.email');
function leerEmailGuardado() {
  try { return fs.readFileSync(EMAIL_FILE, 'utf8').trim(); } catch { return null; }
}

// GET /api/sesion
app.get('/api/sesion', (req, res) => {
  const activa = fs.existsSync(PERFIL_DIR);
  res.json({ activa, email: activa ? leerEmailGuardado() : null });
});

// POST /api/cerrar-sesion
app.post('/api/cerrar-sesion', (req, res) => {
  if (fs.existsSync(PERFIL_DIR)) fs.rmSync(PERFIL_DIR, { recursive: true, force: true });
  res.json({ ok: true });
});

// POST /api/login-manual
app.post('/api/login-manual', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  res.json({ ok: true });

  iniciarSesionConCredenciales(email, password, (msg) => {
    emitirEvento('progreso', { mensaje: msg });
  })
    .then(() => {
      if (fs.existsSync(PERFIL_DIR)) fs.writeFileSync(EMAIL_FILE, email);
      emitirEvento('sesion-guardada', { mensaje: 'Sesión guardada.', email });
    })
    .catch((err) => emitirEvento('error', { mensaje: err.message }));
});

// POST /api/adaptar
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

  estadoActual.estado = 'creando';
  res.json({ ok: true });

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
inicializarDB()
  .catch((err) => console.warn(`⚠️  Sin base de datos (modo local): ${err.message}`))
  .finally(() => app.listen(PORT, () => console.log(`\n✅ App corriendo en http://localhost:${PORT}\n`)));
