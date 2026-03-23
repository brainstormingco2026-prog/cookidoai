let recetaActual = null;

// Elementos del DOM
const secGenerar = document.getElementById('seccion-generar');
const secReceta = document.getElementById('seccion-receta');
const secLogin = document.getElementById('seccion-login');
const secLog = document.getElementById('seccion-log');
const overlay = document.getElementById('overlay-cargando');
const overlayTexto = document.getElementById('overlay-texto');

// —— SSE: escucha eventos del servidor ——
const eventSource = new EventSource('/api/eventos');
eventSource.onerror = () => console.warn('SSE: reconectando...');
eventSource.onmessage = (e) => {
  const datos = JSON.parse(e.data);

  if (datos.tipo === 'progreso') {
    añadirLog(datos.mensaje);
  }

  if (datos.tipo === 'completado') {
    añadirLog('✅ ' + datos.mensaje, 'ok');
    mostrarResultado(datos.mensaje, 'exito');
    if (datos.url) mostrarCompartir(datos.url);
  }

  if (datos.tipo === 'error') {
    añadirLog('❌ ' + datos.mensaje, 'error');
    mostrarResultado('Error: ' + datos.mensaje, 'error');
  }

  if (datos.tipo === 'sesion-guardada') {
    añadirLog('✅ ' + datos.mensaje, 'ok');
    mostrarResultado(datos.mensaje + ' Pulsa "Crear otra receta" para continuar.', 'exito');
  }
};

// —— PASO 1: Generar receta ——
document.getElementById('btn-generar').addEventListener('click', async () => {
  const descripcion = document.getElementById('descripcion').value.trim();
  if (!descripcion) {
    alert('Escribe qué receta quieres generar');
    return;
  }

  mostrarOverlay('Generando receta con ChatGPT...');

  try {
    const res = await fetch('/api/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descripcion }),
    });

    const datos = await res.json();

    if (!res.ok) throw new Error(datos.error);

    recetaActual = datos.receta;
    mostrarReceta(datos.receta);
    mostrar(secReceta);
    ocultar(secGenerar);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    ocultarOverlay();
  }
});

// —— PASO 2: Revisar receta ——
document.getElementById('btn-regenerar').addEventListener('click', () => {
  ocultar(secReceta);
  mostrar(secGenerar);
  recetaActual = null;
});

document.getElementById('btn-aceptar').addEventListener('click', async () => {
  ocultar(secReceta);
  mostrar(secLogin);

  // Comprobar si ya hay sesión guardada
  try {
    const res = await fetch('/api/sesion');
    const datos = await res.json();
    if (datos.activa) {
      ocultar(document.getElementById('login-manual-panel'));
      mostrar(document.getElementById('login-sesion-panel'));
    } else {
      mostrar(document.getElementById('login-manual-panel'));
      ocultar(document.getElementById('login-sesion-panel'));
    }
  } catch { /* muestra el panel de login manual por defecto */ }
});

// —— PASO 3: Login y crear ——
document.getElementById('btn-volver').addEventListener('click', () => {
  ocultar(secLogin);
  mostrar(secReceta);
});

document.getElementById('btn-volver2').addEventListener('click', () => {
  ocultar(secLogin);
  mostrar(secReceta);
});

// Login manual: abre el navegador para que el usuario haga login en Cookidoo
document.getElementById('btn-login-manual').addEventListener('click', async () => {
  document.getElementById('log-mensajes').innerHTML = '';
  document.getElementById('resultado').classList.add('hidden');
  document.getElementById('log-spinner').classList.remove('hidden');
  ocultar(secLogin);
  mostrar(secLog);
  añadirLog('Abriendo navegador de Cookidoo...');

  try {
    await fetch('/api/login-manual', { method: 'POST' });
    // El progreso llega por SSE (sesion-guardada o error)
  } catch (err) {
    añadirLog('Error: ' + err.message, 'error');
    mostrarResultado('Error de conexión', 'error');
  }
});

// Crear receta (sesión ya activa)
document.getElementById('btn-crear').addEventListener('click', async () => {
  document.getElementById('log-mensajes').innerHTML = '';
  document.getElementById('resultado').classList.add('hidden');
  document.getElementById('compartir-panel').classList.add('hidden');
  document.getElementById('log-spinner').classList.remove('hidden');
  ocultar(secLogin);
  mostrar(secLog);

  try {
    await fetch('/api/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receta: recetaActual }),
    });
  } catch (err) {
    añadirLog('Error de conexión: ' + err.message, 'error');
    mostrarResultado('Error de conexión', 'error');
  }
});

// —— Botón "Crear otra receta" ——
document.getElementById('btn-nueva').addEventListener('click', () => {
  recetaActual = null;
  document.getElementById('descripcion').value = '';
  ocultar(secLog);
  ocultar(secReceta);
  ocultar(secLogin);
  mostrar(secGenerar);
});

// —— Helpers ——
function mostrarReceta(r) {
  document.getElementById('receta-titulo').textContent = r.titulo;
  document.getElementById('receta-descripcion').textContent = r.descripcion;
  document.getElementById('receta-porciones').textContent = `👥 ${r.porciones} personas`;
  document.getElementById('receta-tiempo').textContent = `⏱ ${(r.tiempo_preparacion || 0) + (r.tiempo_coccion || 0)} min`;
  document.getElementById('receta-dificultad').textContent = `📊 ${r.dificultad}`;

  const ulIng = document.getElementById('receta-ingredientes');
  ulIng.innerHTML = r.ingredientes
    .map((i) => `<li><strong>${i.cantidad} ${i.unidad}</strong> ${i.nombre}</li>`)
    .join('');

  const olPasos = document.getElementById('receta-pasos');
  olPasos.innerHTML = r.pasos.map((p) => `<li>${p}</li>`).join('');
}

function añadirLog(mensaje, tipo = '') {
  const log = document.getElementById('log-mensajes');
  const div = document.createElement('div');
  div.className = `log-linea ${tipo}`;
  div.textContent = `> ${mensaje}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function mostrarResultado(mensaje, tipo) {
  document.getElementById('log-spinner').classList.add('hidden');
  const resultado = document.getElementById('resultado');
  resultado.classList.remove('hidden');
  const p = document.getElementById('resultado-mensaje');
  p.textContent = mensaje;
  p.className = tipo;
}

function mostrarCompartir(url) {
  const panel = document.getElementById('compartir-panel');
  panel.classList.remove('hidden');

  document.getElementById('link-receta').href = url;

  const titulo = recetaActual?.titulo || 'Mi receta';
  const mensaje = `¡Mira esta receta que hice con Thermomix! 🍳\n*${titulo}*\n${url}`;
  document.getElementById('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}

function mostrarOverlay(texto) {
  overlayTexto.textContent = texto;
  overlay.classList.remove('hidden');
}

function ocultarOverlay() {
  overlay.classList.add('hidden');
}

function mostrar(el) { el.classList.remove('hidden'); }
function ocultar(el) { el.classList.add('hidden'); }
