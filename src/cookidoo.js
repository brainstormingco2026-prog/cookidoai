const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const COOKIDOO_BASE = 'https://cookidoo.es';
const LOGIN_URL = `${COOKIDOO_BASE}/profile/es-ES/login`;
const RECETAS_CREADAS_URL = `${COOKIDOO_BASE}/created-recipes/es-ES`;

const BASE_DIR = path.join(__dirname, '..');

function getPerfilDir(userId) {
  return path.join(BASE_DIR, `chrome-perfil-${userId}`);
}

function getSessionFile(userId) {
  return path.join(BASE_DIR, `cookido-sesion-${userId}.json`);
}

// ── Lanzar Chrome con perfil persistente por usuario ─────────────────────────
async function abrirNavegador(perfilDir, { headless = true } = {}) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
    '--window-size=1280,800',
  ];

  const opts = {
    headless,
    locale: 'es-ES',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  };

  // Intentar con Chrome real (mucho más difícil de detectar como bot)
  try {
    return await chromium.launchPersistentContext(perfilDir, { ...opts, channel: 'chrome' });
  } catch {
    // Fallback a Chromium si Chrome no está instalado
    return await chromium.launchPersistentContext(perfilDir, opts);
  }
}

// ── LOGIN CON CREDENCIALES ────────────────────────────────────────────────────
async function iniciarSesionConCredenciales(email, password, onStatus, userId) {
  const perfilDir = getPerfilDir(userId);
  const log = (msg) => { console.log(`[Cookidoo] ${msg}`); if (onStatus) onStatus(msg); };

  // Limpiar perfil anterior para evitar estados corruptos
  if (fs.existsSync(perfilDir)) {
    fs.rmSync(perfilDir, { recursive: true, force: true });
    log('Perfil anterior limpiado ✓');
  }

  log('Abriendo Chrome para login...');
  const context = await abrirNavegador(perfilDir, { headless: true });
  const page = context.pages()[0] || await context.newPage();

  try {
    // Ocultar señales de automatización
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    log('Abriendo página de login...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    log('URL actual: ' + page.url());

    // Cerrar banner de cookies si aparece antes del formulario
    try {
      const btnCookies = page.locator('#onetrust-accept-btn-handler, button:has-text("Aceptar todo"), button:has-text("Accept All")').first();
      await btnCookies.waitFor({ state: 'visible', timeout: 4000 });
      await btnCookies.click();
      await page.waitForTimeout(800);
    } catch { /* no hay banner */ }

    // Verificar que el formulario de login cargó
    const emailSelector = 'input[type="email"], input[name="email"], #email, input[name="loginEmail"]';
    const emailField = await page.$(emailSelector);
    if (!emailField) {
      await page.screenshot({ path: path.join(BASE_DIR, 'debug_login_bloqueado.png'), fullPage: true });
      throw new Error('No se encontró el formulario de login. Revisa debug_login_bloqueado.png — puede ser un bloqueo de Cloudflare.');
    }

    // Escribir credenciales de forma humana (con delay entre teclas)
    log('Rellenando email...');
    await page.click(emailSelector);
    await page.waitForTimeout(300 + Math.random() * 300);
    await page.type(emailSelector, email, { delay: 60 + Math.random() * 60 });

    await page.waitForTimeout(400 + Math.random() * 400);

    const passSelector = 'input[type="password"], input[name="password"], #password';
    log('Rellenando contraseña...');
    await page.click(passSelector);
    await page.waitForTimeout(300 + Math.random() * 200);
    await page.type(passSelector, password, { delay: 50 + Math.random() * 50 });

    await page.waitForTimeout(500 + Math.random() * 500);

    log('Enviando formulario...');
    await page.click('button[type="submit"]', { timeout: 5000 });

    // Esperar a que la URL salga de la página de login
    log('Esperando confirmación de login...');
    const deadline = Date.now() + 90000;
    let logueado = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500);
      const url = page.url();
      log('URL: ' + url);
      if (!url.includes('/login') && !url.includes('/ciam') && !url.includes('/profile/es-ES/login')) {
        logueado = true;
        break;
      }
    }

    if (!logueado) {
      await page.screenshot({ path: path.join(BASE_DIR, 'debug_login_timeout.png'), fullPage: true });
      // Limpiar perfil inválido
      try { await context.close(); } catch {}
      if (fs.existsSync(perfilDir)) fs.rmSync(perfilDir, { recursive: true, force: true });
      throw new Error('Timeout: Cookidoo no completó el login. Revisa debug_login_timeout.png — puede haber un CAPTCHA o 2FA pendiente.');
    }

    log('Login exitoso ✓ Guardando sesión...');
    // Guardar cookies/localStorage explícitamente en fichero JSON
    await context.storageState({ path: getSessionFile(userId) });
    log('Sesión persistida en disco ✓');
  } catch (err) {
    try { await context.close(); } catch {}
    // Limpiar sesión inválida
    const sf = getSessionFile(userId);
    if (fs.existsSync(sf)) fs.unlinkSync(sf);
    throw err;
  }

  try { await context.close(); } catch {}
  log('Sesión guardada. Ya puedes crear recetas.');
}

// ── CREAR RECETA ──────────────────────────────────────────────────────────────
async function crearRecetaEnCookidoo(receta, _credenciales, onStatus, userId) {
  const sessionFile = getSessionFile(userId);
  const log = (msg) => { console.log(`[Cookidoo] ${msg}`); if (onStatus) onStatus(msg); };

  // Verificar que existe sesión guardada
  if (!fs.existsSync(sessionFile)) {
    throw new Error('No hay sesión de Cookidoo activa. Conéctate desde la app primero.');
  }

  // Lanzar browser sin perfil persistente, cargando las cookies desde el fichero
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  };

  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch {
    browser = await chromium.launch(launchOpts);
  }

  const context = await browser.newContext({
    storageState: sessionFile,
    locale: 'es-ES',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: false,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    log('Navegando a Mis recetas creadas...');
    await page.goto(RECETAS_CREADAS_URL, { waitUntil: 'load' });

    // Si nos redirige a login/ciam, sesión caducada → borrar y pedir reconexión
    if (page.url().includes('login') || page.url().includes('ciam')) {
      log('Sesión caducada. Reconectate a Cookidoo desde la app.');
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      throw new Error('Sesión de Cookidoo caducada. Volvé a conectarte desde la app.');
    }

    log('Sesión activa ✓');

    // ── CERRAR BANNER DE COOKIES ──────────────────────────────────────────────
    await cerrarBannerCookies(page);
    log('Banner de cookies verificado ✓');

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

    await page.waitForLoadState('load');
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
    await page.waitForLoadState('load');
    await cerrarBannerCookies(page);
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
      await page.waitForLoadState('load');
    }

    const urlReceta = page.url().replace(/\/edit\/.*$/, '');
    await page.screenshot({ path: 'receta_creada.png', fullPage: true });
    log('¡Receta creada correctamente! ✓');
    log(`URL: ${urlReceta}`);
    return { ok: true, url: urlReceta };

  } catch (error) {
    log(`Error: ${error.message}`);
    try { await page.screenshot({ path: path.join(BASE_DIR, 'debug_error.png'), fullPage: true }); } catch {}
    throw error;
  } finally {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

// ── CERRAR BANNER COOKIES (reutilizable en cualquier página) ──────────────────
async function cerrarBannerCookies(page) {
  try {
    const btn = page.locator('#onetrust-accept-btn-handler, button:has-text("Aceptar todo"), button:has-text("Accept All")').first();
    await btn.waitFor({ state: 'visible', timeout: 3000 });
    await btn.click();
    await page.locator('#onetrust-consent-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  } catch { /* no hay banner */ }
  // Por si el banner sigue bloqueando clicks, eliminarlo del DOM directamente
  await page.evaluate(() => {
    document.getElementById('onetrust-consent-sdk')?.remove();
    document.getElementById('onetrust-style')?.remove();
  }).catch(() => {});
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

// ── EXTRAER RECETA DESDE URL DE COOKIDOO ──────────────────────────────────────
async function extraerRecetaDeCookidoo(url, onStatus, userId) {
  const perfilDir = getPerfilDir(userId || 'anonimo');
  const log = (msg) => { console.log(`[Cookidoo] ${msg}`); if (onStatus) onStatus(msg); };

  log('Abriendo receta...');
  const context = await abrirNavegador(perfilDir, { headless: true });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    // Extraer texto relevante de la página
    const contenido = await page.evaluate(() => {
      // Intentar JSON-LD primero
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd) return jsonLd.textContent;

      // Fallback: extraer texto del body principal
      const selectores = [
        'main', 'article', '[class*="recipe"]', '[class*="receta"]', '#content'
      ];
      for (const sel of selectores) {
        const el = document.querySelector(sel);
        if (el) return el.innerText;
      }
      return document.body.innerText;
    });

    log('Receta extraída ✓');
    return contenido;
  } finally {
    await context.close();
  }
}

// ── PREVIEW LIGERO DE RECETA DESDE URL DE COOKIDOO ────────────────────────────
async function extraerPreviewReceta(url, userId) {
  const perfilDir = getPerfilDir(userId || 'anonimo');
  const context = await abrirNavegador(perfilDir, { headless: true });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    const preview = await page.evaluate(() => {
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd.textContent);
          const recipe = Array.isArray(data)
            ? data.find(d => d['@type'] === 'Recipe')
            : (data['@type'] === 'Recipe' ? data : null);
          if (recipe) {
            let img = Array.isArray(recipe.image) ? recipe.image[0] : (recipe.image || '');
            if (typeof img === 'object') img = img.url || '';
            return {
              titulo: recipe.name || '',
              descripcion: (recipe.description || '').substring(0, 140),
              imagen: img,
              tiempo_total: recipe.totalTime || recipe.cookTime || '',
              porciones: recipe.recipeYield || '',
            };
          }
        } catch (e) {}
      }
      // Fallback DOM
      const title = document.querySelector('h1')?.textContent?.trim() || document.title || '';
      const imgEl = document.querySelector('article img, main img');
      return { titulo: title, descripcion: '', imagen: imgEl?.src || '', tiempo_total: '', porciones: '' };
    });

    return preview;
  } finally {
    await context.close();
  }
}

module.exports = { crearRecetaEnCookidoo, iniciarSesionConCredenciales, extraerRecetaDeCookidoo, extraerPreviewReceta, getSessionFile };
