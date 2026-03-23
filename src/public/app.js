let recetaActual = null;

// Frases de cocina para la pantalla de progreso
const FRASES = [
  'Precalentando el Thermomix...',
  'Picando los ingredientes finamente...',
  'Mezclando a velocidad perfecta...',
  'Añadiendo el toque secreto del chef...',
  'Dejando reposar los sabores...',
  'Ajustando la temperatura...',
  'Incorporando ingredientes con cuidado...',
  'El aroma ya se siente en la cocina...',
  'Removiendo para que no se pegue...',
  'Probando el punto de sazón...',
  'Dando los últimos retoques...',
  'Emplatando con arte...',
  'Casi listo, paciencia de buen cocinero...',
  'El Thermomix trabajando a pleno rendimiento...',
  'Guardando los secretos de la receta...',
];

const TIEMPO_ESTIMADO = 60; // segundos estimados para el proceso completo

// Elementos
const secPrincipal = document.getElementById('seccion-principal');
const secReceta    = document.getElementById('seccion-receta');
const secProgreso  = document.getElementById('seccion-progreso');
const overlay      = document.getElementById('overlay-cargando');

// —— SSE ——
const eventSource = new EventSource('/api/eventos');
eventSource.onerror = () => console.warn('SSE: reconectando...');
eventSource.onmessage = (e) => {
  const datos = JSON.parse(e.data);

  if (datos.tipo === 'progreso') {
    // No mostramos el log técnico, solo actualizamos internamente
    console.log('[progreso]', datos.mensaje);
  }

  if (datos.tipo === 'completado') {
    detenerProgreso();
    mostrarResultado('¡Receta creada en Cookidoo! 🎉', 'exito');
    if (datos.url) mostrarCompartir(datos.url);
  }

  if (datos.tipo === 'error') {
    detenerProgreso();
    mostrarResultado('Error: ' + datos.mensaje, 'error');
  }

  if (datos.tipo === 'sesion-guardada') {
    detenerProgreso();
    actualizarEstadoSesion(true);
    mostrarResultado('✓ Sesión guardada. Ya puedes crear recetas.', 'exito');
  }
};

// —— Estado de sesión al cargar ——
window.addEventListener('load', async () => {
  try {
    const res = await fetch('/api/sesion');
    const datos = await res.json();
    actualizarEstadoSesion(datos.activa);
  } catch {}
});

function actualizarEstadoSesion(activa) {
  document.getElementById('estado-sesion-ok').classList.toggle('hidden', !activa);
  document.getElementById('estado-sesion-no').classList.toggle('hidden', activa);
}

// —— Login desde pantalla principal ——
document.getElementById('btn-login-principal').addEventListener('click', async () => {
  iniciarProgreso('Abriendo Cookidoo para hacer login...');
  ocultar(secPrincipal);
  mostrar(secProgreso);

  try {
    await fetch('/api/login-manual', { method: 'POST' });
  } catch (err) {
    detenerProgreso();
    mostrarResultado('Error de conexión: ' + err.message, 'error');
  }
});

document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
  await fetch('/api/cerrar-sesion', { method: 'POST' });
  actualizarEstadoSesion(false);
});

// —— Generar receta ——
document.getElementById('btn-generar').addEventListener('click', async () => {
  const descripcion = document.getElementById('descripcion').value.trim();
  if (!descripcion) { alert('Escribe qué receta quieres generar'); return; }

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
    ocultar(secPrincipal);
    mostrar(secReceta);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    ocultarOverlay();
  }
});

// —— Revisar receta ——
document.getElementById('btn-regenerar').addEventListener('click', () => {
  ocultar(secReceta);
  mostrar(secPrincipal);
  recetaActual = null;
});

document.getElementById('btn-aceptar').addEventListener('click', async () => {
  // Verificar sesión antes de continuar
  const res = await fetch('/api/sesion');
  const { activa } = await res.json();

  if (!activa) {
    const confirmar = confirm('No tienes sesión de Cookidoo activa. ¿Quieres conectarte ahora?');
    if (!confirmar) return;
    ocultar(secReceta);
    mostrar(secPrincipal);
    return;
  }

  iniciarProgreso();
  ocultar(secReceta);
  mostrar(secProgreso);

  try {
    await fetch('/api/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receta: recetaActual }),
    });
  } catch (err) {
    detenerProgreso();
    mostrarResultado('Error de conexión: ' + err.message, 'error');
  }
});

// —— Nueva receta ——
document.getElementById('btn-nueva').addEventListener('click', () => {
  recetaActual = null;
  document.getElementById('descripcion').value = '';
  ocultar(secProgreso);
  ocultar(secReceta);
  mostrar(secPrincipal);
  actualizarEstadoSesion; // refresca
  fetch('/api/sesion').then(r => r.json()).then(d => actualizarEstadoSesion(d.activa));
});

// —— PROGRESO ANIMADO ——
let progresoInterval = null;
let tiempoTranscurrido = 0;
let fraseIndex = 0;

function iniciarProgreso(fraseInicial) {
  tiempoTranscurrido = 0;
  fraseIndex = 0;

  const frase = document.getElementById('frase-cocina');
  const tiempo = document.getElementById('tiempo-restante');
  const barra  = document.getElementById('barra-progreso');
  const icono  = document.getElementById('progreso-icono') || document.querySelector('.progreso-icono');
  const resultado = document.getElementById('resultado');

  resultado.classList.add('hidden');
  document.getElementById('compartir-panel').classList.add('hidden');
  document.querySelector('.progreso-centro').classList.remove('hidden');

  frase.textContent = fraseInicial || FRASES[0];
  tiempo.textContent = `Tiempo estimado: ${TIEMPO_ESTIMADO} segundos`;
  barra.style.width = '0%';

  const iconos = ['🍳', '🥘', '🍲', '🧑‍🍳', '⏱️', '🌿', '🔪', '🥄'];
  let iconoIdx = 0;

  progresoInterval = setInterval(() => {
    tiempoTranscurrido++;

    // Actualizar barra (máx 95% hasta que llegue el completado real)
    const pct = Math.min(95, (tiempoTranscurrido / TIEMPO_ESTIMADO) * 100);
    barra.style.width = pct + '%';

    // Tiempo restante
    const restante = Math.max(0, TIEMPO_ESTIMADO - tiempoTranscurrido);
    tiempo.textContent = restante > 0
      ? `Tiempo estimado: ${restante} segundo${restante !== 1 ? 's' : ''}`
      : 'Casi listo...';

    // Cambiar frase cada 8 segundos
    if (tiempoTranscurrido % 8 === 0) {
      fraseIndex = (fraseIndex + 1) % FRASES.length;
      frase.style.opacity = '0';
      setTimeout(() => {
        frase.textContent = FRASES[fraseIndex];
        frase.style.opacity = '1';
      }, 400);
    }

    // Cambiar icono cada 5 segundos
    if (tiempoTranscurrido % 5 === 0) {
      iconoIdx = (iconoIdx + 1) % iconos.length;
      icono.textContent = iconos[iconoIdx];
    }
  }, 1000);
}

function detenerProgreso() {
  if (progresoInterval) { clearInterval(progresoInterval); progresoInterval = null; }
  document.getElementById('barra-progreso').style.width = '100%';
  document.querySelector('.progreso-centro').classList.add('hidden');
}

// —— Helpers ——
function mostrarReceta(r) {
  document.getElementById('receta-titulo').textContent = r.titulo;
  document.getElementById('receta-descripcion').textContent = r.descripcion;
  document.getElementById('receta-porciones').textContent = `👥 ${r.porciones} personas`;
  document.getElementById('receta-tiempo').textContent = `⏱ ${(r.tiempo_preparacion || 0) + (r.tiempo_coccion || 0)} min`;
  document.getElementById('receta-dificultad').textContent = `📊 ${r.dificultad}`;

  document.getElementById('receta-ingredientes').innerHTML = r.ingredientes
    .map(i => `<li><strong>${i.cantidad} ${i.unidad}</strong> ${i.nombre}</li>`).join('');

  document.getElementById('receta-pasos').innerHTML = r.pasos
    .map(p => `<li>${p}</li>`).join('');
}

function mostrarResultado(mensaje, tipo) {
  const resultado = document.getElementById('resultado');
  resultado.classList.remove('hidden');
  const p = document.getElementById('resultado-mensaje');
  p.textContent = mensaje;
  p.className = tipo;
}

function mostrarCompartir(url) {
  document.getElementById('compartir-panel').classList.remove('hidden');
  document.getElementById('link-receta').href = url;
  const titulo = recetaActual?.titulo || 'Mi receta';
  const msg = `¡Mira esta receta que hice con Thermomix! 🍳\n*${titulo}*\n${url}`;
  document.getElementById('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function mostrarOverlay(texto) {
  document.getElementById('overlay-texto').textContent = texto;
  overlay.classList.remove('hidden');
}
function ocultarOverlay() { overlay.classList.add('hidden'); }
function mostrar(el) { el.classList.remove('hidden'); }
function ocultar(el) { el.classList.add('hidden'); }
