# Carga de Nómina para Beneficiarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la carga manual de la hoja `BENEFICIARIOS` por una carga desde un archivo Excel/CSV (la nómina oficial de Scouts de Argentina), con vista previa y reemplazo total en cada carga.

**Architecture:** El parseo del archivo y el mapeo Función→Rama viven enteramente en el cliente (`public/index.html`), usando el SheetJS ya cargado en la página. El backend (Apps Script) recibe el array ya filtrado y mapeado, valida mínimamente y reemplaza el contenido de `BENEFICIARIOS` bajo `LockService`, igual patrón que `addIngreso_`.

**Tech Stack:** Google Apps Script (backend), HTML/CSS/JS vanilla sin build step (frontend, un solo archivo `public/index.html`), SheetJS (ya cargado) para parsear el archivo, Google Sheets como base de datos.

## Global Constraints

- Este proyecto no tiene framework de tests (frontend estático de un solo archivo, sin build step; backend Apps Script sin runner local). La verificación de cada tarea es manual: inspección de código (grep) para el backend, y consola del navegador para el frontend — no hay `npm test` ni equivalente. Esto es consistente con el resto del código existente y con el plan anterior (`2026-07-19-fondo-programa-por-rama.md`).
- `backend/Code.gs` en este repo es una **copia** del backend real, que vive desplegado en el editor de Apps Script de la planilla. Los cambios de este plan se aplican primero acá (repo) y después deben pegarse a mano en el Apps Script real y redesplegarse como **nueva versión** — si no, el Web App sigue sirviendo el código viejo.
- SheetJS (`xlsx-0.20.2`) ya está cargado en `public/index.html:481` (usado hoy por `descargarExcel()` para exportar informes). No se agrega ninguna dependencia nueva — se reutiliza `XLSX.read()` / `XLSX.utils.sheet_to_json()`.
- El ID de beneficiario pasa a ser el DNI. Ya coincide con el ID actual en `BENEFICIARIOS` (confirmado con el usuario), así que los pagos históricos en `INGRESOS_unitario` (columna G, `beneficiarioId`) siguen enlazando correctamente — no hace falta ninguna migración de IDs.
- Cada carga es un **reemplazo total** de `BENEFICIARIOS`: quien figura en el archivo queda activo, quien no figura deja de estarlo.
- Solo estos 4 valores exactos de la columna `Función` del archivo cuentan como beneficiario, mapeados a su rama; cualquier otro valor (educadores, representantes distritales/zonales, etc.) se descarta:
  - `Lobato / Lobezna` → `Manada`
  - `Scout` → `Unidad`
  - `Caminante` → `Caminantes`
  - `Rover` → `Rovers`
- La columna `Nombre` del archivo viene en formato `"Apellido, Nombre"` (un solo string) y se separa por la primera coma para llenar las columnas B (apellido) y C (nombre) de `BENEFICIARIOS`, igual formato que usa hoy el resto del código (`ben[1] + ', ' + ben[2]`).
- No se restringe la sección nueva por rol de usuario (hoy ningún tab del menú está restringido por rol).
- No se guarda el archivo original ni las columnas de la nómina que no se usan (Celular, Categoria, Zona, Distrito, Código, Organismo, Fecha de Nacimiento, Religión).

---

### Task 1: Backend — nueva acción `actualizarBeneficiarios`

**Files:**
- Modify: `backend/Code.gs:52-61` (`ejecutar_`, agregar case)
- Modify: `backend/Code.gs` (agregar `validarBeneficiarios_` y `actualizarBeneficiarios_` después de `addEgreso_`, que termina en la línea 272, y antes de `uploadComprobante_` en la línea 274)

**Interfaces:**
- Consumes: `ss_()` y `LockService` (ya existentes en el archivo, no se tocan).
- Produces: acción `actualizarBeneficiarios`, payload `{ beneficiarios: Array<[dni:string, apellido:string, nombre:string, rama:string]> }` (rama ∈ `['Manada','Unidad','Caminantes','Rovers']`). Devuelve `{ ok:true, total:number, porRama:{Manada:number,Unidad:number,Caminantes:number,Rovers:number}, actualizadoEn:string(ISO) }`. Lo consume el Task 2 (frontend) vía `api('actualizarBeneficiarios', {...})`.

- [ ] **Step 1: Agregar el case en `ejecutar_`**

Reemplazar:
```js
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
```

Por:
```js
function ejecutar_(action, p, user) {
  switch (action) {
    case 'bootstrap':             return bootstrap_(user);
    case 'getMovimientos':        return getMovimientos_();
    case 'addIngreso':            return addIngreso_(p, user);
    case 'addEgreso':             return addEgreso_(p, user);
    case 'uploadComprobante':     return uploadComprobante_(p);
    case 'actualizarBeneficiarios': return actualizarBeneficiarios_(p);
    default: throw new Error('Acción desconocida: ' + action);
  }
}
```

- [ ] **Step 2: Agregar `validarBeneficiarios_` y `actualizarBeneficiarios_`**

Insertar después de la línea 272 (cierre de `addEgreso_`) y antes de la línea 274 (`function uploadComprobante_`):

```js
/** Valida y normaliza las filas ya mapeadas por el cliente. Función pura (sin llamadas a Sheets/Lock). */
function validarBeneficiarios_(filas) {
  const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
  if (!Array.isArray(filas) || !filas.length) throw new Error('No se recibió ningún beneficiario para cargar');

  const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0 };
  const filasValidas = filas.map(function(f) {
    const dni = String(f[0] || '').trim();
    const apellido = String(f[1] || '').trim();
    const nombre = String(f[2] || '').trim();
    const rama = String(f[3] || '').trim();
    if (!dni || !/^\d+$/.test(dni)) throw new Error('DNI inválido: ' + dni);
    if (!apellido || !nombre) throw new Error('Falta apellido o nombre para el DNI ' + dni);
    if (RAMAS.indexOf(rama) < 0) throw new Error('Rama inválida para el DNI ' + dni + ': ' + rama);
    porRama[rama]++;
    return [dni, apellido, nombre, rama, 'SI'];
  });
  return { filasValidas: filasValidas, porRama: porRama };
}

function actualizarBeneficiarios_(p) {
  const resultado = validarBeneficiarios_(p.beneficiarios);
  const ahora = new Date().toISOString();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName('BENEFICIARIOS');
    if (!sh) throw new Error('Falta la pestaña BENEFICIARIOS en la planilla');
    const lastRow = sh.getLastRow();
    if (lastRow > 1) {
      sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
    }
    sh.getRange(2, 1, resultado.filasValidas.length, 5).setValues(resultado.filasValidas);

    const cfg = ss_().getSheetByName('CONFIG');
    const cfgValues = cfg.getDataRange().getValues();
    let escrito = false;
    for (let i = 1; i < cfgValues.length; i++) {
      if (String(cfgValues[i][0] || '').trim() === 'beneficiarios_actualizado_en') {
        cfg.getRange(i + 1, 2).setValue(ahora);
        escrito = true;
        break;
      }
    }
    if (!escrito) cfg.appendRow(['beneficiarios_actualizado_en', ahora]);

    return { ok: true, total: resultado.filasValidas.length, porRama: resultado.porRama, actualizadoEn: ahora };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 3: Verificar (sin runner — inspección manual)**

Run: `grep -n "actualizarBeneficiarios\|validarBeneficiarios_" backend/Code.gs`
Expected: aparece el nuevo `case 'actualizarBeneficiarios'` en `ejecutar_`, y las funciones `validarBeneficiarios_` y `actualizarBeneficiarios_` completas.

Revisar a ojo que:
- `sh.getRange(2, 1, resultado.filasValidas.length, 5)` escribe exactamente 5 columnas (A-E: dni, apellido, nombre, rama, activo), igual que las 5 columnas que lee `getBeneficiarios_` (`backend/Code.gs:147-158`).
- El `clearContent()` solo corre si `lastRow > 1` (evita `getRange` con `numRows=0`, que tira error en Apps Script si `lastRow` es 1, es decir la hoja solo tiene encabezado).

- [ ] **Step 4: Commit**

```bash
git add backend/Code.gs
git commit -m "feat: agregar acción actualizarBeneficiarios para cargar la nómina desde el backend"
```

---

### Task 2: Frontend — Sección "Beneficiarios": carga, vista previa y confirmación

**Files:**
- Modify: `public/index.html:268-275` (nav-links, agregar link)
- Modify: `public/index.html:429-430` (insertar la sección nueva entre Deudores e Informes)
- Modify: `public/index.html:675-694` (`poblarBeneficiarios` queda igual; `showSection` — agregar `'beneficiarios'` al array y el bloque de refresco del badge de última actualización)
- Modify: `public/index.html` (agregar las funciones nuevas después de `poblarBeneficiarios()`, línea 682)
- Modify: `public/index.html:648-665` (`mostrarDashboard`, mostrar el badge de última actualización también al entrar por primera vez)

**Interfaces:**
- Consumes: `api()`, `mostrarMensaje()`, `escapeHtml()`, `beneficiariosData`, `configData`, `poblarBeneficiarios()`, `cargarSaldos()`, `cargarDeudores()` (todas ya existentes). Acción de backend `actualizarBeneficiarios` (Task 1).
- Produces: `procesarFilasNomina(filas)` → función pura, `filas: Array<{Dni, Nombre, 'Función'}>` (formato de `XLSX.utils.sheet_to_json`) → `{ validas: Array<[dni,apellido,nombre,rama]>, porRama: {Manada,Unidad,Caminantes,Rovers}, descartadas: number, errores: number, duplicados: number }`. `filasNominaValidas` (variable global, mismo formato que `validas`) — la usa `confirmarCargaNomina()` en este mismo task.

- [ ] **Step 1: Agregar el link de menú**

Reemplazar:
```html
                        <a href="#" role="button" onclick="showSection('informes'); return false;">Informes</a>
                        <a href="#" role="button" onclick="logout(); return false;">Salir</a>
```

Por:
```html
                        <a href="#" role="button" onclick="showSection('informes'); return false;">Informes</a>
                        <a href="#" role="button" onclick="showSection('beneficiarios'); return false;">Beneficiarios</a>
                        <a href="#" role="button" onclick="logout(); return false;">Salir</a>
```

- [ ] **Step 2: Agregar la sección HTML, entre Deudores e Informes**

Insertar después de la línea 429 (`</section>` de cierre de `deudores-section`) y antes de la línea 431 (`<!-- Sección Informes -->`):

```html
                <!-- Sección Beneficiarios -->
                <section id="beneficiarios-section" class="hidden" aria-labelledby="beneficiarios-title">
                    <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 15px;">
                        <h2 id="beneficiarios-title" style="font-size: 1.3rem;">Beneficiarios</h2>
                        <button class="btn btn-primary btn-sm" onclick="showSection('dashboard')">Volver</button>
                    </div>
                    <div class="card">
                        <p style="font-size: 0.85rem; margin-bottom: 12px;">Subí la nómina exportada del sistema de Scouts de Argentina (Excel o CSV) para reemplazar la lista de beneficiarios activos.</p>
                        <div class="form-group">
                            <label for="nomina-archivo">Archivo de nómina</label>
                            <input type="file" id="nomina-archivo" class="form-control" accept=".xlsx,.xls,.csv" onchange="onArchivoNominaSeleccionado(event)">
                        </div>
                        <div id="nomina-actualizado" style="font-size: 0.8rem; color: var(--marron); margin-bottom: 10px;"></div>
                        <div id="nomina-preview" class="hidden">
                            <div class="table-responsive">
                                <table>
                                    <caption class="visually-hidden">Vista previa de la nómina a cargar, cantidad de beneficiarios por rama</caption>
                                    <thead><tr><th scope="col">Rama</th><th scope="col">Cantidad</th></tr></thead>
                                    <tbody id="nomina-preview-tbody"></tbody>
                                </table>
                            </div>
                            <p id="nomina-preview-descartadas" style="font-size: 0.85rem; margin-top: 8px;"></p>
                            <p id="nomina-preview-errores" style="font-size: 0.85rem; color: var(--error);"></p>
                            <div class="text-right" style="margin-top: 10px;">
                                <button type="button" class="btn" style="background:#ddd;" onclick="cancelarCargaNomina()">Cancelar</button>
                                <button type="button" class="btn btn-success" id="btn-confirmar-nomina" onclick="confirmarCargaNomina()" disabled>Confirmar carga</button>
                            </div>
                        </div>
                        <div id="nomina-mensaje-container" class="form-messages-container"></div>
                    </div>
                </section>

```

- [ ] **Step 3: Actualizar `showSection()` para incluir la sección nueva y mostrar la fecha de última actualización**

Reemplazar:
```js
        async function showSection(s) {
            ['dashboard', 'ingresos', 'egresos', 'deudores', 'informes'].forEach(sec =>
                document.getElementById(`${sec}-section`).classList.add('hidden'));
            document.getElementById(`${s}-section`).classList.remove('hidden');
            if (['dashboard', 'deudores', 'informes'].includes(s)) {
                await refrescarMovimientos();
                if (s === 'dashboard') cargarSaldos();
                if (s === 'deudores') cargarDeudores();
                if (s === 'informes') cargarEjecucionEnTabla();
            }
        }
```

Por:
```js
        async function showSection(s) {
            ['dashboard', 'ingresos', 'egresos', 'deudores', 'informes', 'beneficiarios'].forEach(sec =>
                document.getElementById(`${sec}-section`).classList.add('hidden'));
            document.getElementById(`${s}-section`).classList.remove('hidden');
            if (['dashboard', 'deudores', 'informes'].includes(s)) {
                await refrescarMovimientos();
                if (s === 'dashboard') cargarSaldos();
                if (s === 'deudores') cargarDeudores();
                if (s === 'informes') cargarEjecucionEnTabla();
            }
            if (s === 'beneficiarios') mostrarFechaActualizacionNomina();
        }

        function mostrarFechaActualizacionNomina() {
            const el = document.getElementById('nomina-actualizado');
            const fecha = configData['beneficiarios_actualizado_en'];
            el.textContent = fecha
                ? `Última actualización: ${new Date(fecha).toLocaleString('es-AR')}`
                : 'Todavía no se cargó ninguna nómina desde la app.';
        }
```

- [ ] **Step 4: Agregar el mapeo de Función a Rama y la función pura `procesarFilasNomina`**

Ubicar `poblarBeneficiarios()` (línea 675-682) con `grep -n "function poblarBeneficiarios" public/index.html`, y agregar justo después de su cierre (`}`):

```js
        const FUNCION_A_RAMA = { 'Lobato / Lobezna': 'Manada', 'Scout': 'Unidad', 'Caminante': 'Caminantes', 'Rover': 'Rovers' };

        // Función pura: recibe filas en formato XLSX.utils.sheet_to_json (objetos con las
        // columnas del archivo como propiedades) y devuelve las filas ya mapeadas al formato
        // de BENEFICIARIOS, agrupadas por rama, junto con los contadores de descartes/errores.
        function procesarFilasNomina(filas) {
            const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0 };
            const indicePorDni = new Map();
            const validas = [];
            let descartadas = 0, errores = 0, duplicados = 0;

            filas.forEach(f => {
                const dni = String(f['Dni'] || '').trim();
                const nombreCompleto = String(f['Nombre'] || '').trim();
                const funcion = String(f['Función'] || '').trim();
                const rama = FUNCION_A_RAMA[funcion];
                if (!rama) { descartadas++; return; }

                const idxComa = nombreCompleto.indexOf(',');
                if (!dni || !/^\d+$/.test(dni) || idxComa < 0) { errores++; return; }
                const apellido = nombreCompleto.slice(0, idxComa).trim();
                const nombre = nombreCompleto.slice(idxComa + 1).trim();
                if (!apellido || !nombre) { errores++; return; }

                const fila = [dni, apellido, nombre, rama];
                if (indicePorDni.has(dni)) {
                    const posAnterior = indicePorDni.get(dni);
                    porRama[validas[posAnterior][3]]--;
                    validas[posAnterior] = fila;
                    duplicados++;
                } else {
                    indicePorDni.set(dni, validas.length);
                    validas.push(fila);
                }
                porRama[rama]++;
            });

            return { validas, porRama, descartadas, errores, duplicados };
        }
```

- [ ] **Step 5: Verificar `procesarFilasNomina` en la consola del navegador (sin login)**

Abrir `public/index.html` directamente en el navegador (doble clic, o `start public/index.html`). Abrir la consola de DevTools y pegar:

```js
procesarFilasNomina([
  { Dni: '12345671', Nombre: 'Ríos, Marina Elena', 'Función': 'Asistente Zonal de Fortalecimiento Institucional' },
  { Dni: '12345672', Nombre: 'Ibarra, Susana Beatriz', 'Función': 'Ayudante de Comunidad Rover' },
  { Dni: '30111222', Nombre: 'Pérez, Juan', 'Función': 'Caminante' },
  { Dni: '30111222', Nombre: 'Pérez, Juan', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' },
  { Dni: '30333444', Nombre: 'Gómez, Ana', 'Función': 'Scout' },
  { Dni: '', Nombre: 'Sin Dni, Test', 'Función': 'Rover' }
])
```

Expected:
```js
{
  validas: [ ['30111222','Pérez','Juan','Caminantes'], ['30333444','Gómez','Ana','Unidad'] ],
  porRama: { Manada: 0, Unidad: 1, Caminantes: 1, Rovers: 0 },
  descartadas: 3,   // Rastelli, Mammana, y la 2da fila de Pérez (todas con función no reconocida)
  errores: 1,       // fila sin Dni
  duplicados: 0     // la 2da fila de Pérez se descarta por función no reconocida antes de llegar a la lógica de duplicados
}
```

Ahora, para ejercitar el camino de `duplicados` (dos filas con el **mismo DNI y ambas con función reconocida** — por ejemplo, la nómina trae a alguien que pasó de Scout a Caminante y quedó registrado dos veces), pegar:

```js
procesarFilasNomina([
  { Dni: '30111222', Nombre: 'Pérez, Juan', 'Función': 'Scout' },
  { Dni: '30111222', Nombre: 'Pérez, Juan', 'Función': 'Caminante' }
])
```

Expected:
```js
{
  validas: [ ['30111222','Pérez','Juan','Caminantes'] ],   // se conserva la última fila (Caminante)
  porRama: { Manada: 0, Unidad: 0, Caminantes: 1, Rovers: 0 },   // el conteo de Unidad se descontó al reemplazar
  descartadas: 0,
  errores: 0,
  duplicados: 1
}
```

- [ ] **Step 6: Agregar el manejo del input de archivo y la vista previa**

Agregar después de `procesarFilasNomina`:

```js
        let filasNominaValidas = [];

        function onArchivoNominaSeleccionado(event) {
            const file = event.target.files[0];
            document.getElementById('nomina-mensaje-container').innerHTML = '';
            if (!file) { cancelarCargaNomina(); return; }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const hoja = wb.Sheets[wb.SheetNames[0]];
                    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
                    if (!filas.length || !('Dni' in filas[0]) || !('Nombre' in filas[0]) || !('Función' in filas[0])) {
                        mostrarMensaje('nomina-mensaje-container', '❌ El archivo no tiene las columnas esperadas (Dni, Nombre, Función)', 'error');
                        cancelarCargaNomina();
                        return;
                    }
                    mostrarVistaPreviaNomina(procesarFilasNomina(filas));
                } catch (err) {
                    console.error(err);
                    mostrarMensaje('nomina-mensaje-container', '❌ No se pudo leer el archivo: ' + err.message, 'error');
                    cancelarCargaNomina();
                }
            };
            reader.onerror = () => mostrarMensaje('nomina-mensaje-container', '❌ No se pudo leer el archivo', 'error');
            reader.readAsArrayBuffer(file);
        }

        function mostrarVistaPreviaNomina(resultado) {
            filasNominaValidas = resultado.validas;
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
            document.getElementById('nomina-preview-tbody').innerHTML = RAMAS.map(r =>
                `<tr><td>${escapeHtml(r)}</td><td>${resultado.porRama[r]}</td></tr>`
            ).join('');
            document.getElementById('nomina-preview-descartadas').textContent =
                `${resultado.descartadas} fila(s) descartada(s) (función no reconocida)` +
                (resultado.duplicados ? ` — ${resultado.duplicados} DNI duplicado(s), se conservó la última fila` : '');
            document.getElementById('nomina-preview-errores').textContent =
                resultado.errores ? `${resultado.errores} fila(s) con error (falta DNI o el nombre no tiene el formato "Apellido, Nombre")` : '';
            document.getElementById('nomina-preview').classList.remove('hidden');
            document.getElementById('btn-confirmar-nomina').disabled = filasNominaValidas.length === 0;
        }

        function cancelarCargaNomina() {
            filasNominaValidas = [];
            document.getElementById('nomina-archivo').value = '';
            document.getElementById('nomina-preview').classList.add('hidden');
        }
```

- [ ] **Step 7: Verificar el flujo completo del input de archivo con un CSV real construido en la consola**

Esto ejercita `onArchivoNominaSeleccionado` de punta a punta (FileReader + `XLSX.read` + `sheet_to_json`), no solo la función pura — importante porque el CSV real tiene una columna `Nombre` con una coma adentro (`"Pérez, Juan"`), que tiene que quedar entera en un solo campo (CSV con comillas), no partida en dos columnas.

En la misma consola de DevTools (después del Step 5), pegar:

```js
document.getElementById('beneficiarios-section').classList.remove('hidden');
const csv = 'Tipo de Documento,Dni,Nombre,Celular,Función,Categoria,Zona,Distrito,Código,Organismo,Fecha de Nacimiento,Religión\n'
  + 'DNI,30111222,"Pérez, Juan",1122334455,Caminante,Activo,5,3,466,SAN JOSE OBRERO,01/01/2010,Católica\n'
  + 'DNI,30333444,"Gómez, Ana",1122335566,Scout,Activo,5,3,466,SAN JOSE OBRERO,02/02/2012,Católica\n'
  + 'DNI,12345671,"Ríos, Marina Elena",1155667788,Asistente Zonal de Fortalecimiento Institucional,Activo,5,,9005,Zona 5 - Gran Bs. As. Norte,27/07/1963,Católica\n';
const file = new File([csv], 'nomina_test.csv', { type: 'text/csv' });
const dt = new DataTransfer();
dt.items.add(file);
document.getElementById('nomina-archivo').files = dt.files;
document.getElementById('nomina-archivo').dispatchEvent(new Event('change'));
```

Esperar un instante (el `FileReader` es asíncrono) y después pegar:

```js
document.getElementById('nomina-preview').classList.contains('hidden');
document.getElementById('btn-confirmar-nomina').disabled;
document.getElementById('nomina-preview-tbody').textContent;
filasNominaValidas;
```
Expected: `classList.contains('hidden')` da `false`, `btn-confirmar-nomina.disabled` da `false`, el texto de la tabla incluye `Caminantes1` y `Unidad1`, y `filasNominaValidas` es exactamente `[['30111222','Pérez','Juan','Caminantes'], ['30333444','Gómez','Ana','Unidad']]` — el DNI 12345671 (Rastelli, Asistente Zonal) queda afuera, y el nombre `"Pérez, Juan"` quedó entero en una sola columna del CSV (no se partió por la coma al parsear el archivo).

- [ ] **Step 8: Agregar `confirmarCargaNomina()` y mostrar la fecha de actualización en `mostrarDashboard()`**

Agregar después de `cancelarCargaNomina()`:

```js
        async function confirmarCargaNomina() {
            if (!filasNominaValidas.length) return;
            if (!confirm(`Esto va a reemplazar los ${beneficiariosData.length} beneficiarios activos actuales por los ${filasNominaValidas.length} de este archivo. ¿Continuar?`)) return;

            const btn = document.getElementById('btn-confirmar-nomina');
            btn.disabled = true;
            mostrarMensaje('nomina-mensaje-container', '💾 Actualizando beneficiarios...', 'info');
            try {
                const r = await api('actualizarBeneficiarios', { beneficiarios: filasNominaValidas });
                beneficiariosData = filasNominaValidas.map(f => [f[0], f[1], f[2], f[3]]);
                configData['beneficiarios_actualizado_en'] = r.actualizadoEn;
                poblarBeneficiarios();
                cargarSaldos();
                cargarDeudores();
                mostrarFechaActualizacionNomina();
                mostrarMensaje('nomina-mensaje-container', `✅ Se cargaron ${r.total} beneficiarios activos`, 'success');
                cancelarCargaNomina();
            } catch (e) {
                console.error('Error:', e);
                mostrarMensaje('nomina-mensaje-container', '❌ ' + e.message, 'error');
                btn.disabled = false;
            }
        }
```

Reemplazar en `mostrarDashboard()` (línea 648-665):
```js
                poblarBeneficiarios();
                cargarSaldos();
                cargarDeudores();
            } catch (e) {
                console.error(e);
            }
        }
```

Por:
```js
                poblarBeneficiarios();
                cargarSaldos();
                cargarDeudores();
                mostrarFechaActualizacionNomina();
            } catch (e) {
                console.error(e);
            }
        }
```

- [ ] **Step 9: Verificar `confirmarCargaNomina()` en la consola, mockeando `api()`**

En la misma sesión de consola (después del Step 7, con `filasNominaValidas` ya poblado), pegar:

```js
window.confirm = () => true;  // evita el diálogo bloqueante en la verificación
beneficiariosData = [];
configData = {};
api = async (accion, payload) => {
  console.log('llamada a', accion, payload);
  return { ok: true, total: payload.beneficiarios.length, porRama: { Manada: 0, Unidad: 1, Caminantes: 1, Rovers: 0 }, actualizadoEn: new Date().toISOString() };
};
await confirmarCargaNomina();
beneficiariosData;
configData['beneficiarios_actualizado_en'];
document.getElementById('nomina-actualizado').textContent;
```
Expected: `beneficiariosData` queda con las 2 filas (`['30111222','Pérez','Juan','Caminantes']` y `['30333444','Gómez','Ana','Unidad']`), `configData['beneficiarios_actualizado_en']` tiene un string ISO, y el texto de `nomina-actualizado` empieza con `Última actualización:`.

(Después de este test manual, recargar la página antes de seguir usándola — quedaron pisadas las funciones `confirm` y `api` globales.)

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar sección Beneficiarios para cargar la nómina desde un archivo Excel/CSV"
```

---

### Task 3: Documentar los pasos manuales pendientes

**Files:**
- Modify: `INSTRUCCIONES.md`

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1: Agregar una sección de pendientes específica de esta feature**

Al final de `INSTRUCCIONES.md`, después de la sección `## Pendientes para una próxima etapa` existente, agregar:

```markdown

## Pendiente: Carga de Nómina para Beneficiarios

Cambios de código ya hechos en este repo (`backend/Code.gs` y `public/index.html`). Falta este paso manual para que tengan efecto:

1. En el editor de Apps Script (Extensiones → Apps Script desde la planilla) → agregar el nuevo `case 'actualizarBeneficiarios'` en `ejecutar_`, y las funciones `validarBeneficiarios_` y `actualizarBeneficiarios_` (ver `backend/Code.gs`) → Implementar → Administrar implementaciones → editar la implementación existente → Nueva versión → Implementar.

No hace falta ningún cambio manual en la planilla: `BENEFICIARIOS` ya tiene las columnas que se usan (A-E), y la fila `beneficiarios_actualizado_en` en `CONFIG` se crea sola la primera vez que se confirma una carga.

Después de este paso, hacer `firebase deploy --only hosting` para publicar el `index.html` actualizado con la nueva sección "Beneficiarios".
```

- [ ] **Step 2: Commit**

```bash
git add INSTRUCCIONES.md
git commit -m "docs: agregar pasos manuales pendientes para carga de nómina de beneficiarios"
```

## Self-Review

**Spec coverage:** mapeo Función→Rama y filtro de las 4 funciones válidas (Task 2, `procesarFilasNomina`), separación de "Apellido, Nombre" (Task 2), reemplazo total con `activo='SI'` (Task 1, `actualizarBeneficiarios_`), DNI como ID sin migración (Global Constraints, confirmado con el usuario), nueva sección de menú con input de archivo (Task 2), vista previa con conteos por rama y descartes/errores/duplicados (Task 2), confirmación explícita antes de reemplazar (Task 2, `confirm()`), timestamp de última actualización (Task 1 lo persiste en CONFIG y lo devuelve; Task 2 lo muestra), reutilización de SheetJS ya cargado sin nueva dependencia (Global Constraints), sin restricción por rol (Global Constraints), pasos manuales de despliegue (Task 3). Todo lo del spec está cubierto.

**Placeholders:** ninguno — todos los pasos tienen código completo y verificaciones con salida esperada concreta, incluido un segundo caso de prueba dedicado en el Step 5 de Task 2 para ejercitar el camino de `duplicados` (que el primer caso no llegaba a cubrir, ya que la fila duplicada ahí se descartaba antes por función no reconocida).

**Consistencia de tipos:** `procesarFilasNomina(filas)` se define en Task 2 Step 4 y se consume igual en los Steps 5, 7 y 9 (misma forma de retorno `{validas, porRama, descartadas, errores, duplicados}`). `filasNominaValidas` (array de `[dni,apellido,nombre,rama]`) se define en Step 6 y lo consume `confirmarCargaNomina` en Step 8 con el mismo formato. El payload de `actualizarBeneficiarios` (`{beneficiarios: [[dni,apellido,nombre,rama], ...]}`) coincide entre lo que arma el frontend (Task 2 Step 8) y lo que espera `validarBeneficiarios_` en el backend (Task 1 Step 2: `f[0]`=dni, `f[1]`=apellido, `f[2]`=nombre, `f[3]`=rama). La respuesta del backend (`{ok, total, porRama, actualizadoEn}`) se define en Task 1 y se consume igual en Task 2 Step 8 (`r.total`, `r.actualizadoEn`).

## Desviaciones respecto al plan original

**Auto-detección de encoding en CSV:** el código de Task 2 Step 6 en este plan especifica `XLSX.read(buf, {type:'array'})` sin ninguna opción de codepage — ese bloque quedó obsoleto/superado. Verificación real con CDP encontró que esa llamada mal-interpreta un CSV UTF-8 sin BOM como Windows-1252, corrompiendo justo el nombre de columna acentuado (`Función`) y rechazando el archivo. La solución final, aplicada solo a archivos `.csv` (los `.xlsx`/`.xls` binarios siguen el camino original sin tocar), decodifica los bytes con `TextDecoder('utf-8', {fatal:true})` y, si falla, reintenta con `TextDecoder('windows-1252')` — así soporta UTF-8 con o sin BOM y CP1252 legado sin adivinar a ciegas ni romper ningún caso. Ver `decodificarTextoNomina()` en `public/index.html` y el detalle completo en `.superpowers/sdd/task-2-report.md`.

**Excepción de rama por DNI (`excepciones_rama_dni`):** no estaba en el spec original. Al probar con una exportación real de nómina, se encontró que al menos una beneficiaria activa (categoría "Protagonista") tiene su única fila de `Función` en un rol de comité/asamblea en vez de su rama real, así que `FUNCION_A_RAMA` la descarta correctamente en general pero incorrectamente en este caso puntual. Para no hardcodear el DNI de una persona (y menor) en el código fuente versionado, se agregó un mecanismo configurable desde la pestaña `CONFIG` (clave `excepciones_rama_dni`, formato `dni:rama;dni:rama`) que fuerza la rama de un DNI puntual por encima de la columna Función. Ver `parsearExcepcionesRama()` en `public/index.html` y el paso manual correspondiente en `INSTRUCCIONES.md`.

**Backend — orden de validación y registro de autor (`actualizarBeneficiarios_`):** el código de Task 1 Steps 1-2 en este plan quedó parcialmente obsoleto tras una revisión final. La versión final valida que exista la hoja `CONFIG` y que `BENEFICIARIOS` tenga suficientes filas/columnas ANTES de `clearContent()` (el plan original limpiaba primero), agrega un chequeo de DNI repetido dentro de `validarBeneficiarios_`, y la acción pasa a recibir `user` (`actualizarBeneficiarios_(p, user)`) para registrar `beneficiarios_actualizado_por` en `CONFIG` junto al timestamp existente. Ver el código final en `backend/Code.gs` y el detalle en `.superpowers/sdd/task-1-report.md`.
