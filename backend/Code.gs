/**
 * ============================================================
 * BACKEND SEGURO - Sistema Contable Grupo Scout SJO N°466
 * ============================================================
 * Google Apps Script vinculado a la planilla (Extensiones > Apps Script).
 * Implementar como Web App: "Ejecutar como: Yo" / "Acceso: Cualquier usuario".
 *
 * Script Properties requeridas (Configuración del proyecto > Propiedades):
 *   CLIENT_ID            -> Client ID de OAuth (el mismo del frontend)
 *   FOLDER_EGRESOS       -> ID carpeta Drive para archivos de egresos
 *   FOLDER_INGRESOS      -> ID carpeta Drive para adjuntos de ingresos
 *   FOLDER_COMPROBANTES  -> ID carpeta Drive para comprobantes generados
 *   SPREADSHEET_ID       -> (opcional) solo si el script NO está vinculado a la planilla
 *
 * La planilla debe tener una pestaña USUARIOS con columnas:
 *   A: EMAIL | B: ROL | C: ACTIVO (SI/NO)
 */

const PROPS = PropertiesService.getScriptProperties();
const CLIENT_ID = PROPS.getProperty('CLIENT_ID');
const FOLDER_EGRESOS = PROPS.getProperty('FOLDER_EGRESOS');
const FOLDER_INGRESOS = PROPS.getProperty('FOLDER_INGRESOS');
const FOLDER_COMPROBANTES = PROPS.getProperty('FOLDER_COMPROBANTES');

function ss_() {
  const id = PROPS.getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

// ========== ENTRADA HTTP ==========
function doGet(e) {
  return json_({ ok: true, data: 'API Scout activa' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const email = verificarToken_(req.token);
    const user = verificarUsuario_(email);
    const data = ejecutar_(req.action, req.payload || {}, user);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ejecutar_(action, p, user) {
  switch (action) {
    case 'bootstrap':         return bootstrap_(user);
    case 'getMovimientos':    return getMovimientos_();
    case 'addIngreso':        return addIngreso_(p, user);
    case 'addEgreso':         return addEgreso_(p, user);
    case 'uploadComprobante': return uploadComprobante_(p);
    default: throw new Error('Acción desconocida: ' + action);
  }
}

// ========== AUTENTICACIÓN ==========
/** Verifica el ID token de Google contra el endpoint oficial. Cachea 5 min. */
function verificarToken_(token) {
  if (!token) throw new Error('AUTH: falta el token de sesión');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const cached = cache.get(key);
  if (cached) return cached;

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: sesión inválida o vencida');

  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) throw new Error('AUTH: el token no pertenece a esta aplicación');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH: email no verificado');

  cache.put(key, info.email, 300);
  return info.email;
}

/**
 * Valida el email contra la pestaña USUARIOS (allowlist en la planilla).
 * Detecta las columnas por nombre en la fila 1 (Email / Rol / Activo),
 * así funciona con la estructura existente aunque haya columnas extra.
 */
function verificarUsuario_(email) {
  const sh = ss_().getSheetByName('USUARIOS');
  if (!sh) throw new Error('AUTH: falta la pestaña USUARIOS en la planilla');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error('AUTH: la pestaña USUARIOS está vacía');

  const header = values[0].map(function(h) { return String(h).toLowerCase(); });
  let colEmail = header.findIndex(function(h) { return h.indexOf('email') >= 0 || h.indexOf('correo') >= 0; });
  let colRol = header.findIndex(function(h) { return h.indexOf('rol') >= 0; });
  let colActivo = header.findIndex(function(h) { return h.indexOf('activo') >= 0; });
  if (colEmail < 0) colEmail = 0;
  if (colRol < 0) colRol = 1;

  for (let i = 1; i < values.length; i++) {
    const rowEmail = String(values[i][colEmail] || '').trim().toLowerCase();
    // Si no hay columna ACTIVO, se considera activo por estar en la lista
    const activo = colActivo >= 0
      ? String(values[i][colActivo] || '').trim().toUpperCase()
      : 'SI';
    if (rowEmail === String(email).trim().toLowerCase() && (activo === 'SI' || activo === 'SÍ')) {
      return { email: email, rol: String(values[i][colRol] || 'CARGA') };
    }
  }
  throw new Error('AUTH: la cuenta ' + email + ' no está autorizada');
}

// ========== LECTURAS ==========
function leer_(nombre) {
  const sh = ss_().getSheetByName(nombre);
  return sh ? sh.getDataRange().getValues() : [];
}

function bootstrap_(user) {
  return {
    user: user,
    config: getConfig_(),
    beneficiarios: getBeneficiarios_(),
    categorias: getCategorias_(),
    movimientos: getMovimientos_()
  };
}

function getConfig_() {
  const values = leer_('CONFIG');
  const cfg = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || '').trim();
    if (!k) continue;
    const v = values[i][1];
    if (typeof v === 'number') cfg[k] = v;
    else if (/\d/.test(String(v)) && /^[\d.,\s$-]+$/.test(String(v).trim())) cfg[k] = num_(v);
    else cfg[k] = String(v == null ? '' : v);
  }
  return cfg;
}

function getBeneficiarios_() {
  const values = leer_('BENEFICIARIOS');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const activo = String(r[4] || '').trim().toUpperCase();
    if (activo === 'SI' || activo === 'SÍ') {
      out.push([String(r[0]), String(r[1] || ''), String(r[2] || ''), String(r[3] || '')]);
    }
  }
  return out;
}

function getCategorias_() {
  const values = leer_('CATEGORIAS');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[0]) === 'Egreso' && String(r[2] || '').toUpperCase().indexOf('S') === 0) {
      // [tipo, nombre, activo, presupuesto numérico]
      out.push([String(r[0]), String(r[1] || ''), String(r[2] || ''), num_(r[3])]);
    }
  }
  return out;
}

/** Devuelve movimientos con fechas ISO (yyyy-mm-dd) y montos numéricos. */
function getMovimientos_() {
  const ing = leer_('INGRESOS_unitario');
  const egr = leer_('EGRESOS');
  const ingresos = [];
  for (let i = 1; i < ing.length; i++) {
    const r = ing[i];
    if (!r[0] && !r[4]) continue;
    ingresos.push([toISO_(r[0]), String(r[1] || ''), String(r[2] || ''),
                   String(r[3] || ''), num_(r[4]), String(r[5] || ''), String(r[6] || '')]);
  }
  const egresos = [];
  for (let i = 1; i < egr.length; i++) {
    const r = egr[i];
    if (!r[0] && !r[4]) continue;
    egresos.push([toISO_(r[0]), String(r[1] || ''), String(r[2] || ''),
                  String(r[3] || ''), num_(r[4]), String(r[5] || ''), String(r[8] || '')]);
  }
  return { ingresos: ingresos, egresos: egresos };
}

// ========== ESCRITURAS ==========
function addIngreso_(p, user) {
  const monto = num_(p.monto);
  if (!p.fecha || !p.rubro || !(monto > 0)) throw new Error('Faltan campos obligatorios');

  let beneficiario = 'General', rama = '-';
  if (p.beneficiarioId) {
    const b = getBeneficiarios_().find(function(x) { return String(x[0]) === String(p.beneficiarioId); });
    if (b) { beneficiario = b[1] + ', ' + b[2]; rama = b[3]; }
  }

  let concepto;
  if (p.rubro === 'Cuota') {
    concepto = p.cuota === 'Cuota 1' ? 'Afiliación 1° cuota' : 'Afiliación 2° cuota';
  } else {
    concepto = p.rubro;
  }

  const detalleAdicional = String(p.detalleAdicional || '').trim();
  let detalle;
  const conBeneficiario = ['Cuota', 'Campamento Invierno', 'Campamento Verano'].indexOf(p.rubro) >= 0;
  if (conBeneficiario) {
    detalle = beneficiario + ' (' + rama + ')' + (detalleAdicional ? ' - ' + detalleAdicional : '');
  } else {
    detalle = detalleAdicional
      ? detalleAdicional + (beneficiario !== 'General' ? ' - ' + beneficiario : '')
      : (beneficiario !== 'General' ? beneficiario : p.rubro);
  }

  let linkAdjunto = '';
  if (p.archivo && p.archivo.base64) {
    linkAdjunto = subirArchivo_(p.archivo, FOLDER_INGRESOS);
  }

  // Número correlativo atómico: nadie más puede escribir mientras se calcula
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const numero = proximoComprobante_();
    ss_().getSheetByName('INGRESOS_unitario').appendRow([
      p.fecha, detalle, concepto, numero, monto, linkAdjunto,
      p.beneficiarioId ? String(p.beneficiarioId) : ''
    ]);
    return { numero: numero, concepto: concepto, beneficiario: beneficiario, rama: rama, linkAdjunto: linkAdjunto };
  } finally {
    lock.releaseLock();
  }
}

function proximoComprobante_() {
  let max = 0;
  const ing = leer_('INGRESOS_unitario');
  for (let i = 1; i < ing.length; i++) {
    const n = parseInt(ing[i][3], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  const comp = leer_('COMPROBANTES');
  for (let i = 1; i < comp.length; i++) {
    const n = parseInt(comp[i][1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

function addEgreso_(p, user) {
  const monto = num_(p.monto);
  if (!p.fecha || !p.rubro || !(monto > 0)) throw new Error('Faltan campos obligatorios');

  const rama = String(p.rama || '').trim();
  if (p.rubro === 'Programa' && !rama) throw new Error('Falta la rama para un gasto de Programa');

  let linkArchivo = '';
  if (p.archivo && p.archivo.base64) {
    linkArchivo = subirArchivo_(p.archivo, FOLDER_EGRESOS);
  }

  ss_().getSheetByName('EGRESOS').appendRow([
    p.fecha, String(p.rubro), String(p.detalle || ''), String(p.comprobante || ''),
    monto, linkArchivo, user.email, new Date().toISOString(), rama
  ]);
  return { ok: true, linkArchivo: linkArchivo };
}

function uploadComprobante_(p) {
  if (!p.numero || !p.base64) throw new Error('Datos del comprobante incompletos');
  const bytes = Utilities.base64Decode(p.base64);
  const blob = Utilities.newBlob(bytes, 'image/png', 'comprobante_' + p.numero + '.png');
  const file = DriveApp.getFolderById(FOLDER_COMPROBANTES).createFile(blob);
  compartirPorLink_(file);
  const link = file.getUrl();
  ss_().getSheetByName('COMPROBANTES').appendRow([
    new Date().toISOString(), p.numero, link,
    String(p.fecha || ''), String(p.beneficiario || ''), num_(p.monto)
  ]);
  return { link: link };
}

function subirArchivo_(archivo, folderId) {
  if (!folderId) throw new Error('Falta configurar la carpeta de Drive (Script Properties)');
  const bytes = Utilities.base64Decode(archivo.base64);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('El archivo supera los 10MB');
  const nombre = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH-mm-ss")
    + '_' + String(archivo.name || 'adjunto');
  const blob = Utilities.newBlob(bytes, archivo.mimeType || 'application/octet-stream', nombre);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  compartirPorLink_(file);
  return file.getUrl();
}

/**
 * Comparte un archivo como "cualquiera con el enlace: lector".
 * El link es imposible de adivinar y la carpeta sigue restringida,
 * así el dirigente puede ver/reenviar el comprobante sin exponer el resto.
 */
function compartirPorLink_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Si la cuenta no permite compartir por link, el archivo queda restringido
    console.error('No se pudo compartir por link: ' + e);
  }
}

// ========== HELPERS DE NORMALIZACIÓN ==========
/** Convierte Date, serial de Sheets, dd/mm/yyyy o ISO a 'yyyy-mm-dd'. */
function toISO_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String