const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const COOKIDOO_BASE = 'https://cookidoo.es';
const LOGIN_URL = `${COOKIDOO_BASE}/profile/es-ES/login`;
const RECETAS_CREADAS_URL = `${COOKIDOO_BASE}/created-recipes/es-ES`;

// Directorio del perfil de Chrome persistente (guarda cookies, sesión, etc.)
const PERFIL_DIR = path.join(__dirname, '..', 'chrome-perfil');

// ── Lanzar Chrome real con perfil persistente ─────────────────────────────────
async function abrirNavegador() {
  return chromium.launchPersistentContext(PERFIL_DIR, {
    channel: 'chrome',          // Chrome real instalado en el sistema
    headless: false,
    slowMo: 150,
    locale: 'es-ES',
    viewport: null,             // ventana de tamaño real
    args: ['--start-maximized'],
  });
}

// ── LOGIN MANUAL (primera vez o sesión caducada) ──────────────────────────────
async function iniciarSesionManual(onStatus) {
  const log = (msg) => { console.log(`[Cookidoo] ${msg}`); if (onStatus) onStatus(msg); };

  log('Abriendo Chrome... inicia sesión en Cookidoo');
  const context = await abrirNavegador();
  const page = context.pages()[0] || await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  log('🔐 Inicia sesión en el navegador. Cuando estés dentro de Cookidoo la app continuará...');

  // Espera hasta que el usuario esté logueado en cookidoo.es (hasta 3 min)
  await page.waitForURL(`${COOKIDOO_BASE}/**`, { timeout: 180000 });

  // Asegurarse de que no nos quedamos en una URL de login/ciam
  await page.waitForFunction(
    (base) => window.location.href.startsWith(base) && !window.location.href.includes('login') && !window.location.href.includes('ciam'),
    COOKIDOO_BASE,
    { timeout: 30000 }
  );

  log('Login detectado ✓ Guardando sesión...');
  await context.close();
  log('Sesión guardada en el perfil de Chrome. No necesitarás hacer login de nuevo.');
}

// ── CREAR RECETA ──────────────────────────────────────────────────────────────
async function crearRecetaEnCookidoo(receta, _credenciales, onStatus) {
  const log = (msg) => { console.log(`[Cookidoo] ${msg}`); if (onStatus) onStatus(msg); };

  // Si no hay perfil guardado, hacer login manual primero
  const perfilExiste = fs.existsSync(PERFIL_DIR);
  if (!perfilExiste) {
    log('Primera vez: necesitas hacer login manual...');
    await iniciarSesionManual(onStatus);
  }

  const context = await abrirNavegador();
  const page = context.pages()[0] || await context.newPage();

  try {
    log('Navegando a Mis recetas creadas...');
    await page.goto(RECETAS_CREADAS_URL, { waitUntil: 'networkidle' });

    // Si nos redirige a login/ciam, sesión caducada → login manual
    if (page.url().includes('login') || page.url().includes('ciam')) {
      log('Sesión caducada. Iniciando login manual...');
      await context.close();
      // Borra perfil para forzar login limpio
      fs.rmSync(PERFIL_DIR, { recursive: true, force: true });
      await iniciarSesionManual(onStatus);
      return crearRecetaEnCookidoo(receta, {}, onStatus);
    }

    log('Sesión activa ✓');
    await page.screenshot({ path: 'debug_recetas_creadas.png', fullPage: true });

    // ── BOTÓN CREAR RECETA ────────────────────────────────────────────────────
    log('Buscando botón de crear receta...');
    // Paso 1: botón flotante (+) que abre el dropdown
    const botonFlotante = await buscarBoton(page, [
      'button.cr-floating-button__btn',
      '.cr-floating-button__btn',
      'button:has(.icon--plus)',
    ], 8000);

    if (!botonFlotante) {
      await page.screenshot({ path: 'debug_sin_boton.png', fullPage: true });
      throw new Error('No se encontró el botón flotante (+). Revisa debug_sin_boton.png');
    }

    await botonFlotante.click();
    log('Dropdown abierto, buscando "Crear receta"...');

    // Paso 2: opción "Crear receta" dentro del dropdown
    const botonCrear = await buscarBoton(page, [
      '#create-button',
      'button#create-button',
      '.core-dropdown-list__item:has-text("Crear receta")',
      'button:has-text("Crear receta")',
    ], 5000);

    if (!botonCrear) {
      await page.screenshot({ path: 'debug_sin_crear.png', fullPage: true });
      throw new Error('No se encontró "Crear receta" en el dropdown. Revisa debug_sin_crear.png');
    }

    await botonCrear.click();
    log('Popup abierto, esperando campo de título...');

    // ── POPUP: TÍTULO ─────────────────────────────────────────────────────────
    const campoTitulo = await buscarCampo(page, [
      '#recipe-title',
      'input[name="recipeName"]',
      'input[placeholder="Ponle un título a tu receta"]',
    ], 10000);

    if (!campoTitulo) {
      await page.screenshot({ path: 'debug_popup.png', fullPage: true });
      throw new Error('No se encontró el campo de título. Revisa debug_popup.png');
    }

    await campoTitulo.fill(receta.titulo);
    log(`Título: "${receta.titulo}"`);

    log('Confirmando título...');
    await page.click('button[type="submit"].button--primary', { timeout: 5000 });
    log('Receta creada, cargando editor...');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'debug_tras_popup.png', fullPage: true });
    log('Popup confirmado ✓');

    // ── BOTÓN "AÑADIR INGREDIENTES" ───────────────────────────────────────────
    log('Buscando botón "añadir ingredientes"...');
    const btnIngredientes = await buscarBoton(page, [
      'a:has-text("añadir ingredientes")',
      'a:has-text("Añadir ingredientes")',
      'a[href*="ingredients-and-preparation-steps"]',
      'a[href*="ingredients"]',
    ], 10000);

    if (!btnIngredientes) {
      await page.screenshot({ path: 'debug_sin_ingredientes.png', fullPage: true });
      throw new Error('No se encontró el botón "añadir ingredientes". Revisa debug_sin_ingredientes.png');
    }

    await btnIngredientes.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'debug_editor_ingredientes.png', fullPage: true });
    log('Editor de ingredientes cargado ✓');

    // ── INGREDIENTES ──────────────────────────────────────────────────────────
    log('Añadiendo ingredientes...');
    for (let i = 0; i < receta.ingredientes.length; i++) {
      await añadirIngrediente(page, receta.ingredientes[i], i, log);
      await page.waitForTimeout(400);
    }

    // ── BOTÓN "AÑADIR PRIMER PASO" ────────────────────────────────────────────
    log('Buscando botón "Añadir primer paso"...');
    await page.click('#add-steps, button:has-text("Añadir primer paso")', { timeout: 10000 });
    await page.waitForTimeout(600);
    log('Editor de pasos abierto ✓');

    // ── PASOS ─────────────────────────────────────────────────────────────────
    log('Añadiendo pasos...');
    for (let i = 0; i < receta.pasos.length; i++) {
      await añadirPaso(page, receta.pasos[i], i, log);
      await page.waitForTimeout(400);
    }

    // ── GUARDAR ───────────────────────────────────────────────────────────────
    log('Guardando receta...');
    const botonGuardar = await buscarBoton(page, [
      'button:has-text("Guardar")',
      'button:has-text("Publicar")',
      'button:has-text("Save")',
      'button:has-text("Publish")',
      '[data-testid*="save"]',
      'button[type="submit"]',
    ], 5000);

    if (botonGuardar) {
      await botonGuardar.click();
      await page.waitForLoadState('networkidle');
    }

    const urlReceta = page.url();
    await page.screenshot({ path: 'receta_creada.png', fullPage: true });
    log('¡Receta creada correctamente! ✓');
    log(`URL: ${urlReceta}`);
    return { ok: true, url: urlReceta };

  } catch (error) {
    log(`Error: ${error.message}`);
    try { await page.screenshot({ path: 'debug_error.png', fullPage: true }); } catch {}
    throw error;
  } finally {
    await page.waitForTimeout(3000);
    await context.close();
  }
}

// ── ESCRIBIR EN CR-TEXT-FIELD (web component contenteditable) ─────────────────
async function escribirEnCrTextField(locator, texto) {
  await locator.click({ timeout: 5000, force: true });
  await locator.evaluate((el, txt) => {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, txt);
  }, texto);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function buscarBoton(page, selectores, timeout = 5000) {
  for (const sel of selectores) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ timeout, state: 'visible' });
      return el;
    } catch { continue; }
  }
  return null;
}

async function buscarCampo(page, selectores, timeout = 5000) {
  for (const sel of selectores) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ timeout, state: 'visible' });
      return el;
    } catch { continue; }
  }
  return null;
}

async function intentarRellenar(page, selectores, valor, nombreCampo, log) {
  for (const sel of selectores) {
    try {
      await page.fill(sel, valor, { timeout: 3000 });
      log(`Campo "${nombreCampo}" rellenado`);
      return;
    } catch { continue; }
  }
  log(`Campo "${nombreCampo}" no encontrado, continuando...`);
}

async function añadirIngrediente(page, ingrediente, indice, log) {
  const texto = `${ingrediente.cantidad} ${ingrediente.unidad} ${ingrediente.nombre}`.trim();

  // A partir del segundo ingrediente, pulsa el botón "+" para crear un nuevo box
  if (indice > 0) {
    await page.locator('button.cr-manage-list__add-button--desktop').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
  }

  // Cuando estamos en ingredientes aún no existen cr-text-field de pasos,
  // así que el último cr-text-field es siempre el del ingrediente recién creado
  const campo = page.locator('cr-text-field[contenteditable="true"]').last();
  await campo.waitFor({ state: 'visible', timeout: 5000 });
  try {
    await escribirEnCrTextField(campo, texto);
    log(`Ingrediente ${indice + 1}: ${texto}`);
  } catch (e) {
    log(`⚠ No se pudo añadir ingrediente ${indice + 1}: ${e.message}`);
  }
}

async function añadirPaso(page, paso, indice, log) {
  const texto = paso.replace(/^(paso|step)\s*\d+\s*:\s*/gi, '').trim();

  // Paso 1: el campo ya existe (lo abrió #add-steps), escribir directo
  // Pasos siguientes: primero pulsar "+" para crear nuevo campo, luego escribir
  if (indice > 0) {
    const btn = page.locator('button.cr-manage-list__add-button--desktop').last();
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(400);
  }

  // El campo activo tiene contenteditable="true"
  const campo = page.locator('cr-text-field[placeholder="Describir paso"][contenteditable="true"]').last();
  await campo.waitFor({ state: 'visible', timeout: 8000 });

  try {
    await escribirEnCrTextField(campo, texto);
    log(`Paso ${indice + 1}: ${texto.substring(0, 60)}...`);
  } catch (e) {
    log(`⚠ No se pudo añadir paso ${indice + 1}: ${e.message}`);
  }
}

module.exports = { crearRecetaEnCookidoo, iniciarSesionManual };
