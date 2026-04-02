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
    console.log('[progreso]', datos.mensaje);
    // Mostrar en el modal de login si está en curso
    const modal = document.getElementById('modal-login');
    if (!modal.classList.contains('hidden')) {
      const msg = datos.mensaje
        .replace(/\s*Revisa debug[^\s]*\.png[^.]*\./gi, '.')
        .replace(/^URL(?: actual)?:.*$/i, '')
        .trim();
      if (msg) document.getElementById('login-cargando-msg').textContent = msg;
    }
  }

  if (datos.tipo === 'completado') {
    detenerProgreso();
    mostrarResultado('¡Receta creada en Cookidoo! 🎉', 'exito');
    if (datos.url) mostrarCompartir(datos.url);
  }

  if (datos.tipo === 'error') {
    if (!document.getElementById('modal-login').classList.contains('hidden')) {
      // Error durante login desde modal — mostrar razón real, preparar reintento
      const mensajeLimpio = (datos.mensaje || 'Error desconocido')
        .replace(/\s*Revisa debug[^\s]*\.png[^.]*\./gi, '.')
        .replace(/\.$/, '')
        .trim();
      mostrarErrorInline('error-login', mensajeLimpio);
      document.getElementById('login-acciones').classList.remove('hidden');
      document.getElementById('login-cargando').classList.add('hidden');
      document.getElementById('login-cargando-msg').textContent = 'Conectando...';
    } else {
      detenerProgreso();
      const esSesionCookidoo = datos.mensaje && (
        datos.mensaje.includes('No hay sesión de Cookidoo') ||
        datos.mensaje.includes('caducada') ||
        datos.mensaje.includes('Conéctate desde la app')
      );
      if (esSesionCookidoo) {
        // Abrir modal de login en lugar de mostrar error
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        ocultarErrorInline('error-login');
        document.getElementById('modal-login').classList.remove('hidden');
      } else {
        mostrarResultado('Error: ' + datos.mensaje, 'error');
      }
    }
  }

  if (datos.tipo === 'sesion-guardada') {
    // Cerrar modal si estaba abierto
    document.getElementById('modal-login').classList.add('hidden');
    document.getElementById('login-acciones').classList.remove('hidden');
    document.getElementById('login-cargando').classList.add('hidden');
    document.getElementById('login-cargando-msg').textContent = 'Conectando...';
    actualizarEstadoSesion(true, datos.email);
    // Si estamos en pantalla de progreso (login tras error de sesión), volver a la receta para reintentar
    if (!secProgreso.classList.contains('hidden')) {
      detenerProgreso();
      ocultar(secProgreso);
      mostrar(secReceta);
    }
  }
};

// —— Menú usuario ——
window.addEventListener('load', async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return;
    const { nombre, email } = await res.json();
    document.getElementById('user-nombre').textContent = nombre || '';
    document.getElementById('user-email').textContent = email || '';
    document.getElementById('user-avatar').textContent = (nombre || '?')[0].toUpperCase();
  } catch {}
});

// Actualizar email en dropdown cuando se carga la sesión Cookidoo
const _origActualizarEstadoSesion = actualizarEstadoSesion;

document.getElementById('btn-user-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('user-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('user-dropdown').classList.add('hidden');
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
});

// —— Estado de sesión al cargar ——
window.addEventListener('load', async () => {
  try {
    const res = await fetch('/api/sesion');
    const datos = await res.json();
    actualizarEstadoSesion(datos.activa, datos.email);
  } catch {}
});

function actualizarEstadoSesion(activa, email) {
  document.getElementById('estado-sesion-ok').classList.toggle('hidden', !activa);
  document.getElementById('estado-sesion-no').classList.toggle('hidden', activa);
  if (email) document.getElementById('sesion-email').textContent = email;
}

// —— Login desde pantalla principal ——
document.getElementById('btn-login-principal').addEventListener('click', () => {
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('modal-login').classList.remove('hidden');
});

document.getElementById('btn-login-cancelar').addEventListener('click', () => {
  const id = document.getElementById('modal-login').dataset.pollingId;
  if (id) clearInterval(id);
  document.getElementById('modal-login').classList.add('hidden');
  document.getElementById('login-acciones').classList.remove('hidden');
  document.getElementById('login-cargando').classList.add('hidden');
  document.getElementById('login-cargando-msg').textContent = 'Conectando...';
  ocultarErrorInline('error-login');
});

document.getElementById('btn-login-confirmar').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  if (!email || !password) { mostrarErrorInline('error-login', 'Completa todos los campos'); return; }
  ocultarErrorInline('error-login');

  // Mostrar estado de carga dentro del modal, sin cerrarlo ni navegar
  document.getElementById('login-acciones').classList.add('hidden');
  document.getElementById('login-cargando').classList.remove('hidden');
  document.getElementById('login-cargando').classList.add('flex');

  try {
    await fetch('/api/login-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    // Polling como fallback por si el SSE no llega
    document.getElementById('login-cargando-msg').textContent = 'Se abrirá Chrome brevemente para completar el login...';
    const intervalo = setInterval(async () => {
      try {
        const r = await fetch('/api/sesion');
        const d = await r.json();
        if (d.activa) {
          clearInterval(intervalo);
          document.getElementById('modal-login').classList.add('hidden');
          document.getElementById('login-acciones').classList.remove('hidden');
          document.getElementById('login-cargando').classList.add('hidden');
          actualizarEstadoSesion(true, d.email);
        }
      } catch {}
    }, 3000);
    document.getElementById('modal-login').dataset.pollingId = intervalo;
  } catch (err) {
    mostrarErrorInline('error-login', 'Error de conexión: ' + err.message);
    document.getElementById('login-acciones').classList.remove('hidden');
    document.getElementById('login-cargando').classList.add('hidden');
  }
});

document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
  await fetch('/api/cerrar-sesion', { method: 'POST' });
  actualizarEstadoSesion(false);
});

// —— Tabs modo ——
const TABS = ['crear', 'adaptar', 'foto'];

function activarTab(nombre) {
  TABS.forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    const form = document.getElementById(`form-${t}`);
    const activo = t === nombre;
    form.classList.toggle('hidden', !activo);
    btn.classList.toggle('bg-surface-container-lowest', activo);
    btn.classList.toggle('text-on-surface', activo);
    btn.classList.toggle('shadow-sm', activo);
    btn.classList.toggle('text-on-surface-variant', !activo);
  });
}

TABS.forEach(t => document.getElementById(`tab-${t}`).addEventListener('click', () => activarTab(t)));

// —— Preview foto / PDF ——
document.getElementById('input-foto').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('zona-foto').classList.add('hidden');

  if (file.type === 'application/pdf') {
    document.getElementById('pdf-nombre').textContent = file.name;
    document.getElementById('preview-pdf').classList.remove('hidden');
    document.getElementById('preview-pdf').classList.add('flex');
    document.getElementById('preview-foto').classList.add('hidden');
  } else {
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('img-preview').src = ev.target.result;
      document.getElementById('preview-foto').classList.remove('hidden');
      document.getElementById('preview-pdf').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }
});

function quitarArchivoFoto() {
  document.getElementById('input-foto').value = '';
  document.getElementById('img-preview').src = '';
  document.getElementById('preview-foto').classList.add('hidden');
  document.getElementById('preview-pdf').classList.add('hidden');
  document.getElementById('preview-pdf').classList.remove('flex');
  document.getElementById('zona-foto').classList.remove('hidden');
}
document.getElementById('btn-quitar-foto').addEventListener('click', quitarArchivoFoto);
document.getElementById('btn-quitar-pdf').addEventListener('click', quitarArchivoFoto);

// —— Foto de receta ——
document.getElementById('btn-foto').addEventListener('click', async () => {
  const file = document.getElementById('input-foto').files[0];
  if (!file) { mostrarErrorInline('error-foto', 'Selecciona o toma una foto de la receta'); return; }
  ocultarErrorInline('error-foto');
  const detalles = document.getElementById('detalles-foto').value.trim();

  mostrarOverlay('Interpretando receta...');
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch('/api/foto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen: base64, tipo: file.type, detalles }),
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);
    recetaActual = datos.receta;
    mostrarReceta(datos.receta);
    buscarImagenReceta(datos.receta.imagen_busqueda || datos.receta.titulo);
    ocultar(secPrincipal);
    mostrar(secReceta);
  } catch (err) {
    mostrarErrorInline('error-foto', err.message);
  } finally {
    ocultarOverlay();
  }
});

// —— Preview de receta al introducir URL ——
let previewTimeout = null;

document.getElementById('url-receta').addEventListener('input', () => {
  clearTimeout(previewTimeout);
  const url = document.getElementById('url-receta').value.trim();
  if (!url || !url.includes('cookidoo')) {
    ocultar(document.getElementById('preview-receta'));
    return;
  }
  previewTimeout = setTimeout(() => cargarPreviewReceta(url), 700);
});

async function cargarPreviewReceta(url) {
  const previewEl = document.getElementById('preview-receta');
  document.getElementById('preview-titulo').textContent = 'Cargando...';
  document.getElementById('preview-tiempo').textContent = '';
  const imgEl = document.getElementById('preview-imagen');
  imgEl.style.display = '';
  imgEl.src = '';
  mostrar(previewEl);

  try {
    const res = await fetch(`/api/preview-receta?url=${encodeURIComponent(url)}`);
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);

    const p = datos.preview;
    document.getElementById('preview-titulo').textContent = p.titulo || 'Receta de Cookidoo';

    const tiempoEl = document.getElementById('preview-tiempo');
    tiempoEl.innerHTML = p.tiempo_total
      ? `<span class="material-symbols-outlined" style="font-size:13px">schedule</span> ${formatearTiempoISO(p.tiempo_total)}`
      : '';

    if (p.imagen) {
      imgEl.src = p.imagen;
    } else {
      imgEl.style.display = 'none';
    }
  } catch (err) {
    ocultar(previewEl);
  }
}

function formatearTiempoISO(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  if (h && m) return `${h}h ${m}min`;
  if (h) return `${h}h`;
  if (m) return `${m}min`;
  return iso;
}

// —— Adaptar receta existente ——
document.getElementById('btn-adaptar').addEventListener('click', async () => {
  const url = document.getElementById('url-receta').value.trim();
  if (!url) { mostrarErrorInline('error-adaptar', 'Pega el link de la receta en Cookidoo'); return; }
  ocultarErrorInline('error-adaptar');
  const detalles = document.getElementById('detalles-adaptar').value.trim();

  mostrarOverlay('Leyendo receta de Cookidoo...');
  try {
    const res = await fetch('/api/adaptar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, detalles }),
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);
    recetaActual = datos.receta;
    mostrarReceta(datos.receta);
    buscarImagenReceta(datos.receta.imagen_busqueda || datos.receta.titulo);
    ocultar(secPrincipal);
    mostrar(secReceta);
  } catch (err) {
    mostrarErrorInline('error-adaptar', err.message);
  } finally {
    ocultarOverlay();
  }
});

// —— Generar receta ——
document.getElementById('btn-generar').addEventListener('click', async () => {
  const descripcion = document.getElementById('descripcion').value.trim();
  if (!descripcion) { mostrarErrorInline('error-crear', 'Escribe qué receta quieres generar'); return; }
  ocultarErrorInline('error-crear');
  const detalles = document.getElementById('detalles').value.trim();

  mostrarOverlay('Generando receta para tu Thermomix...');
  try {
    const res = await fetch('/api/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descripcion, detalles }),
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);
    recetaActual = datos.receta;
    mostrarReceta(datos.receta);
    buscarImagenReceta(datos.receta.imagen_busqueda || datos.receta.titulo);
    ocultar(secPrincipal);
    mostrar(secReceta);
  } catch (err) {
    mostrarErrorInline('error-crear', err.message);
  } finally {
    ocultarOverlay();
  }
});

// —— Aviso sesión inactiva en pantalla de receta ——
document.getElementById('btn-cerrar-aviso').addEventListener('click', () => {
  document.getElementById('aviso-sesion').classList.add('hidden');
});
document.getElementById('btn-ir-login').addEventListener('click', () => {
  document.getElementById('aviso-sesion').classList.add('hidden');
  ocultar(secReceta);
  mostrar(secPrincipal);
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('modal-login').classList.remove('hidden');
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
  const { activa, email } = await res.json();
  actualizarEstadoSesion(activa, email);

  if (!activa) {
    document.getElementById('aviso-sesion').classList.remove('hidden');
    document.getElementById('aviso-sesion').classList.add('flex');
    return;
  }
  document.getElementById('aviso-sesion').classList.add('hidden');

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
function volverAlInicio() {
  recetaActual = null;
  document.getElementById('descripcion').value = '';
  document.getElementById('detalles').value = '';
  // Ocultar resultado y sus sub-paneles
  document.getElementById('resultado').classList.add('hidden');
  document.getElementById('panel-exito').classList.add('hidden');
  document.getElementById('panel-error').classList.add('hidden');
  document.getElementById('compartir-panel').classList.add('hidden');
  ocultar(secProgreso);
  ocultar(secReceta);
  mostrar(secPrincipal);
  fetch('/api/sesion').then(r => r.json()).then(d => actualizarEstadoSesion(d.activa, d.email));
}
document.getElementById('btn-nueva').addEventListener('click', volverAlInicio);
document.getElementById('btn-nueva-error').addEventListener('click', volverAlInicio);

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
  document.getElementById('compartir-panel')?.classList.add('hidden');
  document.getElementById('progreso-centro')?.classList.remove('hidden');

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
    const pctEl = document.getElementById('progreso-pct');
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';

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
    if (icono && tiempoTranscurrido % 5 === 0) {
      iconoIdx = (iconoIdx + 1) % iconos.length;
      icono.textContent = iconos[iconoIdx];
    }
  }, 1000);
}

function detenerProgreso() {
  if (progresoInterval) { clearInterval(progresoInterval); progresoInterval = null; }
  document.getElementById('barra-progreso').style.width = '100%';
  document.getElementById('progreso-centro')?.classList.add('hidden');
}

// —— Helpers ——
const INGREDIENT_ICONS = ['set_meal','forest','layers','egg_alt','eco','grain','water_drop','breakfast_dining','cookie','lunch_dining','spa','liquor'];

async function buscarImagenReceta(titulo) {
  const wrap = document.getElementById('receta-imagen-wrap');
  const placeholder = document.getElementById('receta-imagen-placeholder');
  wrap.classList.add('hidden');
  placeholder.classList.remove('hidden');
  try {
    const res = await fetch(`/api/imagen?q=${encodeURIComponent(titulo)}`);
    const datos = await res.json();
    if (datos.imagen) {
      document.getElementById('receta-imagen').src = datos.imagen;
      document.getElementById('receta-imagen').alt = titulo;
      document.getElementById('receta-imagen-autor-nombre').textContent = datos.autor || '';
      document.getElementById('receta-imagen-autor').href = datos.autorUrl || '#';
      placeholder.classList.add('hidden');
      wrap.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('No se pudo cargar imagen:', err.message);
  }
}

function mostrarReceta(r) {
  document.getElementById('receta-titulo').textContent = r.titulo;
  document.getElementById('receta-descripcion').textContent = r.descripcion;
  document.getElementById('receta-porciones').textContent = `${r.porciones} personas`;
  document.getElementById('receta-tiempo').textContent = `${(r.tiempo_preparacion || 0) + (r.tiempo_coccion || 0)} min`;
  document.getElementById('receta-dificultad').textContent = r.dificultad;

  // Ingredientes con tarjetas y alternancia de fondo
  document.getElementById('receta-ingredientes').innerHTML = r.ingredientes.map((ing, i) => {
    const bg = i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50';
    const icon = INGREDIENT_ICONS[i % INGREDIENT_ICONS.length];
    return `
      <li class="flex items-center gap-4 p-4 ${bg} rounded-xl">
        <div class="w-12 h-12 bg-surface-container-low rounded-lg flex items-center justify-center flex-shrink-0">
          <span class="material-symbols-outlined text-secondary">${icon}</span>
        </div>
        <div class="flex-1">
          <p class="font-bold text-on-surface leading-tight text-lg">${ing.cantidad} ${ing.unidad} ${ing.nombre}</p>
        </div>
      </li>`;
  }).join('');

  // Pasos con línea de tiempo y numeración
  const linea = '<div class="absolute left-6 top-8 bottom-8 w-0.5 bg-surface-container-highest"></div>';
  const pasos = r.pasos.map((paso, i) => {
    const circulo = `<div class="absolute left-0 top-0 w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant font-headline font-black z-10">${i + 1}</div>`;
    const contenido = `<div class="p-8"><p class="text-on-surface-variant leading-relaxed text-lg">${paso}</p></div>`;
    return `<li class="relative pl-16">${circulo}${contenido}</li>`;
  }).join('');

  document.getElementById('receta-pasos').innerHTML = linea + pasos;
}

function mostrarResultado(mensaje, tipo) {
  const resultado = document.getElementById('resultado');
  resultado.classList.remove('hidden');
  if (tipo === 'exito') {
    document.getElementById('panel-exito').classList.remove('hidden');
    document.getElementById('panel-exito').classList.add('flex');
    document.getElementById('panel-error').classList.add('hidden');
  } else {
    document.getElementById('panel-error').classList.remove('hidden');
    document.getElementById('panel-error').classList.add('flex');
    document.getElementById('panel-exito').classList.add('hidden');
    document.getElementById('resultado-mensaje').textContent = mensaje;
  }
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
  overlay.classList.add('flex');
}
function ocultarOverlay() {
  overlay.classList.add('hidden');
  overlay.classList.remove('flex');
}
function mostrar(el) { el.classList.remove('hidden'); }
function ocultar(el) { el.classList.add('hidden'); }

// —— Editor de receta ——
const secEditar = document.getElementById('seccion-editar');

function abrirEditor() {
  const r = recetaActual;
  document.getElementById('edit-titulo').value = r.titulo || '';
  document.getElementById('edit-descripcion').value = r.descripcion || '';
  document.getElementById('edit-porciones').value = r.porciones || '';
  document.getElementById('edit-tiempo-prep').value = r.tiempo_preparacion || 0;
  document.getElementById('edit-tiempo-coccion').value = r.tiempo_coccion || 0;

  const sel = document.getElementById('edit-dificultad');
  sel.value = r.dificultad || 'Media';
  if (!sel.value) sel.value = 'Media';

  document.getElementById('edit-ingredientes').innerHTML = '';
  (r.ingredientes || []).forEach(ing => agregarFilaIngrediente(ing));

  document.getElementById('edit-pasos').innerHTML = '';
  (r.pasos || []).forEach(paso => agregarFilaPaso(paso));

  ocultar(secReceta);
  mostrar(secEditar);
  secEditar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function agregarFilaIngrediente(ing = {}) {
  const li = document.createElement('li');
  li.className = 'flex gap-2 items-center';
  li.innerHTML = `
    <input type="text" placeholder="Cant." value="${escHtml(String(ing.cantidad || ''))}" class="w-20 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary edit-ing-cantidad"/>
    <input type="text" placeholder="Unidad" value="${escHtml(ing.unidad || '')}" class="w-24 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary edit-ing-unidad"/>
    <input type="text" placeholder="Ingrediente" value="${escHtml(ing.nombre || '')}" class="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary edit-ing-nombre"/>
    <button type="button" class="text-on-surface-variant hover:text-error transition-colors btn-eliminar-ing">
      <span class="material-symbols-outlined text-base">delete</span>
    </button>
  `;
  li.querySelector('.btn-eliminar-ing').addEventListener('click', () => li.remove());
  document.getElementById('edit-ingredientes').appendChild(li);
}

function agregarFilaPaso(texto = '') {
  const lista = document.getElementById('edit-pasos');
  const li = document.createElement('li');
  li.className = 'flex gap-3 items-start';
  const num = lista.children.length + 1;
  li.innerHTML = `
    <span class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant font-bold text-sm flex-shrink-0 mt-2">${num}</span>
    <textarea rows="3" class="flex-1 bg-surface-container-lowest border border-outline-variant rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-primary edit-paso-texto">${escHtml(texto)}</textarea>
    <button type="button" class="text-on-surface-variant hover:text-error transition-colors mt-2 btn-eliminar-paso">
      <span class="material-symbols-outlined text-base">delete</span>
    </button>
  `;
  li.querySelector('.btn-eliminar-paso').addEventListener('click', () => {
    li.remove();
    document.querySelectorAll('#edit-pasos li span').forEach((el, i) => { el.textContent = i + 1; });
  });
  lista.appendChild(li);
}

function guardarEdicion() {
  recetaActual = {
    ...recetaActual,
    titulo: document.getElementById('edit-titulo').value.trim(),
    descripcion: document.getElementById('edit-descripcion').value.trim(),
    porciones: parseInt(document.getElementById('edit-porciones').value) || recetaActual.porciones,
    tiempo_preparacion: parseInt(document.getElementById('edit-tiempo-prep').value) || 0,
    tiempo_coccion: parseInt(document.getElementById('edit-tiempo-coccion').value) || 0,
    dificultad: document.getElementById('edit-dificultad').value,
    ingredientes: Array.from(document.querySelectorAll('#edit-ingredientes li')).map(li => ({
      cantidad: li.querySelector('.edit-ing-cantidad').value.trim(),
      unidad: li.querySelector('.edit-ing-unidad').value.trim(),
      nombre: li.querySelector('.edit-ing-nombre').value.trim(),
    })).filter(ing => ing.nombre),
    pasos: Array.from(document.querySelectorAll('#edit-pasos .edit-paso-texto')).map(t => t.value.trim()).filter(Boolean),
  };
  mostrarReceta(recetaActual);
  ocultar(secEditar);
  mostrar(secReceta);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('btn-editar').addEventListener('click', abrirEditor);
document.getElementById('btn-guardar-edicion').addEventListener('click', guardarEdicion);
document.getElementById('btn-cancelar-edicion').addEventListener('click', () => { ocultar(secEditar); mostrar(secReceta); });
document.getElementById('edit-add-ingrediente').addEventListener('click', () => agregarFilaIngrediente());
document.getElementById('edit-add-paso').addEventListener('click', () => agregarFilaPaso());

function mostrarErrorInline(id, msg) {
  const el = document.getElementById(id);
  const msgEl = document.getElementById(id + '-msg');
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('flex');
}
function ocultarErrorInline(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
}
