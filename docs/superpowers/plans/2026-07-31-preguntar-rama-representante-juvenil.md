# Preguntar Rama para "Representante Juvenil" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando la nómina trae una fila cuya `Función` contiene "Representante Juvenil" y esa persona no tiene ya una excepción configurada, la vista previa de la carga debe pedirle al admin que elija su rama real (en vez de clasificarla como "Educadores"), y guardar esa elección automáticamente como excepción para que las próximas cargas ya la reconozcan.

**Architecture:** Toda la detección y el armado del payload viven en el cliente (`public/index.html`), igual que el resto de la lógica de la carga de nómina. El backend (Apps Script) extiende la acción `actualizarBeneficiarios` ya existente para aceptar y persistir las nuevas excepciones en `CONFIG.excepciones_rama_dni`, bajo el mismo lock que ya usa para el resto de la escritura — no agrega ninguna acción nueva.

**Tech Stack:** Google Apps Script (backend), HTML/CSS/JS vanilla sin build step (frontend, un solo archivo `public/index.html`), Google Sheets como base de datos.

## Global Constraints

- Este proyecto no tiene framework de tests. Verificación manual: consola del navegador para el frontend, grep/inspección para el backend.
- `backend/Code.gs` es una **copia** del backend real; los cambios se pegan a mano en el Apps Script real y se redespliegan como **nueva versión**.
- Una fila es candidata a "pendiente de rama" solo si no resuelve rama por excepción (`CONFIG.excepciones_rama_dni`) ni por Función exacta (una de las 4 ramas), y su `Función` contiene `"representante juvenil"` (case-insensitive, substring — no anclado al inicio, para cubrir variantes futuras del título).
- Si el mismo DNI tiene, en el mismo archivo, otra fila que sí resuelve rama (por excepción o Función exacta), esa gana y la persona no aparece como pendiente — mismo criterio que ya usa el desempate de DNI duplicado existente (`public/index.html:784-798`).
- No existe una opción de "saltear" a un pendiente: toda persona pendiente debe recibir una rama de las 4 (Manada/Unidad/Caminantes/Rovers — nunca "Educadores") para poder confirmar la carga.
- Al confirmar, la asignación se persiste en `CONFIG.excepciones_rama_dni` en el mismo formato ya existente (`dni:rama;dni:rama`), agregada a lo que ya hubiera (o reemplazando la entrada si el DNI ya existía ahí, aunque en operación normal eso no debería pasar).
- No se valida la elección de rama contra fecha de nacimiento ni ningún otro dato — se confía en el admin.

---

### Task 1: Frontend — detectar pendientes de rama en `procesarFilasNomina`

**Files:**
- Modify: `public/index.html:763-802` (`procesarFilasNomina`)

**Interfaces:**
- Consumes: `FUNCION_A_RAMA`, `esFuncionEducador` (ya existentes, sin cambios).
- Produces: `procesarFilasNomina(filas, excepcionesRama)` ahora devuelve `{ validas, porRama, descartadas, errores, duplicados, pendientesRama }`, donde `pendientesRama: Array<{dni: string, apellido: string, nombre: string}>` — las personas que necesitan que se les asigne una rama. Lo consume el Task 2 (`mostrarVistaPreviaNomina`, `confirmarCargaNomina`).

- [ ] **Step 1: Reemplazar `procesarFilasNomina`**

Reemplazar:
```js
        function procesarFilasNomina(filas, excepcionesRama) {
            const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0, Educadores: 0 };
            const indicePorDni = new Map();
            const validas = [];
            let descartadas = 0, errores = 0, duplicados = 0;

            filas.forEach(f => {
                const dni = String(f['Dni'] || '').trim();
                const nombreCompleto = String(f['Nombre'] || '').trim();
                const funcion = String(f['Función'] || '').trim();
                const rama = (excepcionesRama || Object.create(null))[dni] || FUNCION_A_RAMA[funcion]
                    || (esFuncionEducador(funcion) ? 'Educadores' : '');
                if (!rama) { descartadas++; return; }

                const idxComa = nombreCompleto.indexOf(',');
                if (!dni || !/^\d+$/.test(dni) || idxComa < 0) { errores++; return; }
                const apellido = nombreCompleto.slice(0, idxComa).trim();
                const nombre = nombreCompleto.slice(idxComa + 1).trim();
                if (!apellido || !nombre) { errores++; return; }

                const fila = [dni, apellido, nombre, rama];
                if (indicePorDni.has(dni)) {
                    const posAnterior = indicePorDni.get(dni);
                    const ramaAnterior = validas[posAnterior][3];
                    if (ramaAnterior !== rama) duplicados++;
                    // Una rama concreta de chicos gana sobre la categoría genérica "Educadores",
                    // sin importar en qué orden vengan las filas en el archivo — evita que una
                    // segunda fila con un rol de comité/asamblea le saque la rama real a un chico.
                    if (ramaAnterior !== 'Educadores' && rama === 'Educadores') { return; }
                    porRama[ramaAnterior]--;
                    validas[posAnterior] = fila;
                } else {
                    indicePorDni.set(dni, validas.length);
                    validas.push(fila);
                }
                porRama[rama]++;
            });

            return { validas, porRama, descartadas, errores, duplicados };
        }
```

Por:
```js
        function procesarFilasNomina(filas, excepcionesRama) {
            const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0, Educadores: 0 };
            const indicePorDni = new Map();
            const validas = [];
            const candidatosPendientes = new Map();
            let descartadas = 0, errores = 0, duplicados = 0;

            filas.forEach(f => {
                const dni = String(f['Dni'] || '').trim();
                const nombreCompleto = String(f['Nombre'] || '').trim();
                const funcion = String(f['Función'] || '').trim();
                const excepcion = (excepcionesRama || Object.create(null))[dni];
                let rama = excepcion || FUNCION_A_RAMA[funcion];

                // Alguien con un rol de "Representante Juvenil..." es un joven/protagonista, no un
                // educador — pero el archivo no dice su rama real. Si no hay excepción ni match
                // exacto, no se descarta ni se manda a "Educadores": queda pendiente de que el
                // admin le asigne una rama en la vista previa (Task 2).
                if (!rama && /representante juvenil/i.test(funcion)) {
                    const idxComaCand = nombreCompleto.indexOf(',');
                    if (dni && /^\d+$/.test(dni) && idxComaCand >= 0) {
                        const apellidoCand = nombreCompleto.slice(0, idxComaCand).trim();
                        const nombreCand = nombreCompleto.slice(idxComaCand + 1).trim();
                        if (apellidoCand && nombreCand) {
                            candidatosPendientes.set(dni, [apellidoCand, nombreCand]);
                        }
                    }
                    return;
                }

                if (!rama) rama = esFuncionEducador(funcion) ? 'Educadores' : '';
                if (!rama) { descartadas++; return; }

                const idxComa = nombreCompleto.indexOf(',');
                if (!dni || !/^\d+$/.test(dni) || idxComa < 0) { errores++; return; }
                const apellido = nombreCompleto.slice(0, idxComa).trim();
                const nombre = nombreCompleto.slice(idxComa + 1).trim();
                if (!apellido || !nombre) { errores++; return; }

                const fila = [dni, apellido, nombre, rama];
                if (indicePorDni.has(dni)) {
                    const posAnterior = indicePorDni.get(dni);
                    const ramaAnterior = validas[posAnterior][3];
                    if (ramaAnterior !== rama) duplicados++;
                    if (ramaAnterior !== 'Educadores' && rama === 'Educadores') { return; }
                    porRama[ramaAnterior]--;
                    validas[posAnterior] = fila;
                } else {
                    indicePorDni.set(dni, validas.length);
                    validas.push(fila);
                }
                porRama[rama]++;
            });

            // Un candidato deja de ser "pendiente" si su DNI terminó resuelto por otra fila
            // (una rama exacta o una excepción), sin importar en qué orden vinieran las filas.
            const pendientesRama = [];
            candidatosPendientes.forEach((datos, dni) => {
                if (!indicePorDni.has(dni)) {
                    pendientesRama.push({ dni, apellido: datos[0], nombre: datos[1] });
                }
            });

            return { validas, porRama, descartadas, errores, duplicados, pendientesRama };
        }
```

- [ ] **Step 2: Verificar en la consola del navegador (sin login)**

Abrir `public/index.html` directamente en el navegador. Consola de DevTools:

```js
procesarFilasNomina([
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' }
], {})
```
Expected: `pendientesRama` = `[{ dni: '12345676', apellido: 'Medina Torres', nombre: 'Delfina Abril' }]`, `validas` = `[]`, `descartadas === 0`.

```js
// Mismo DNI, pero con una fila que sí resuelve una rama real — no debe quedar pendiente.
procesarFilasNomina([
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Caminante' },
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' }
], {})
```
Expected: `pendientesRama = []`, `validas = [['12345676','Medina Torres','Delfina Abril','Caminantes']]`, `porRama.Caminantes === 1`.

```js
// Mismo caso, orden inverso (la fila ambigua aparece primero en el archivo) — el resultado
// tiene que ser idéntico al anterior. Esto es justo el tipo de dependencia de orden que causó
// un bug real en el desempate de duplicados de una versión anterior de esta función.
procesarFilasNomina([
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' },
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Caminante' }
], {})
```
Expected: mismo resultado que el caso anterior — `pendientesRama = []`, `validas = [['12345676','Medina Torres','Delfina Abril','Caminantes']]`, `porRama.Caminantes === 1`.

```js
// Con una excepción ya configurada para ese DNI — tampoco debe quedar pendiente.
procesarFilasNomina([
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' }
], { '12345676': 'Caminantes' })
```
Expected: `pendientesRama = []`, `validas = [['12345676','Medina Torres','Delfina Abril','Caminantes']]`.

```js
// Un educador normal no debe verse afectado.
procesarFilasNomina([
  { Dni: '12345673', Nombre: 'Funes, Ricardo Omar', 'Función': 'Sub-Jefe de Grupo' }
], {})
```
Expected: `pendientesRama = []`, `validas = [['12345673','Funes','Ricardo Omar','Educadores']]` (sin cambios respecto al comportamiento ya existente).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: detectar filas de Representante Juvenil como pendientes de asignar rama"
```

---

### Task 2: Frontend — selector de rama por pendiente en la vista previa

**Files:**
- Modify: `public/index.html:459-473` (HTML de `#nomina-preview`, agregar contenedor de pendientes)
- Modify: `public/index.html:816-895` (`filasNominaValidas`/`mostrarVistaPreviaNomina`/`cancelarCargaNomina`/`confirmarCargaNomina`)

**Interfaces:**
- Consumes: `resultado.pendientesRama` (Task 1).
- Produces: `pendientesRamaActual` (variable global, mismo array que `pendientesRama`) y `actualizarEstadoConfirmarNomina()` (función global, sin retorno, recalcula si `#btn-confirmar-nomina` debe estar deshabilitado). `confirmarCargaNomina()` ahora manda `nuevasExcepciones: [{dni, rama}, ...]` en el payload de `actualizarBeneficiarios` — lo consume el Task 3 (backend).

- [ ] **Step 1: Agregar el contenedor HTML de pendientes**

Reemplazar:
```html
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
```

Por:
```html
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
                            <div id="nomina-pendientes" class="hidden" style="margin-top: 10px;">
                                <p style="font-size: 0.85rem; font-weight: 600; color: var(--marron);">Figuran con un rol especial (Representante Juvenil) — elegí la rama real de cada uno para poder confirmar la carga:</p>
                                <div id="nomina-pendientes-lista"></div>
                            </div>
                            <div class="text-right" style="margin-top: 10px;">
                                <button type="button" class="btn" style="background:#ddd;" onclick="cancelarCargaNomina()">Cancelar</button>
                                <button type="button" class="btn btn-success" id="btn-confirmar-nomina" onclick="confirmarCargaNomina()" disabled>Confirmar carga</button>
                            </div>
                        </div>
```

- [ ] **Step 2: Agregar `pendientesRamaActual` y `actualizarEstadoConfirmarNomina`, y actualizar `mostrarVistaPreviaNomina`**

Reemplazar:
```js
        let filasNominaValidas = [];
```

Por:
```js
        let filasNominaValidas = [];
        let pendientesRamaActual = [];
```

Reemplazar:
```js
        function mostrarVistaPreviaNomina(resultado) {
            filasNominaValidas = resultado.validas;
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers', 'Educadores'];
            document.getElementById('nomina-preview-tbody').innerHTML = RAMAS.map(r =>
                `<tr><td>${escapeHtml(r)}</td><td>${resultado.porRama[r]}</td></tr>`
            ).join('');
            document.getElementById('nomina-preview-descartadas').textContent =
                `${resultado.descartadas} fila(s) descartada(s) (sin función o "Padre representante...")` +
                (resultado.duplicados ? ` — ${resultado.duplicados} DNI duplicado(s), se conservó la rama más específica` : '');
            document.getElementById('nomina-preview-errores').textContent =
                resultado.errores ? `${resultado.errores} fila(s) con error (falta DNI o el nombre no tiene el formato "Apellido, Nombre")` : '';
            document.getElementById('nomina-preview').classList.remove('hidden');
            document.getElementById('btn-confirmar-nomina').disabled = filasNominaValidas.length === 0;
        }
```

Por:
```js
        function mostrarVistaPreviaNomina(resultado) {
            filasNominaValidas = resultado.validas;
            pendientesRamaActual = resultado.pendientesRama;
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers', 'Educadores'];
            document.getElementById('nomina-preview-tbody').innerHTML = RAMAS.map(r =>
                `<tr><td>${escapeHtml(r)}</td><td>${resultado.porRama[r]}</td></tr>`
            ).join('');
            document.getElementById('nomina-preview-descartadas').textContent =
                `${resultado.descartadas} fila(s) descartada(s) (sin función o "Padre representante...")` +
                (resultado.duplicados ? ` — ${resultado.duplicados} DNI duplicado(s), se conservó la rama más específica` : '');
            document.getElementById('nomina-preview-errores').textContent =
                resultado.errores ? `${resultado.errores} fila(s) con error (falta DNI o el nombre no tiene el formato "Apellido, Nombre")` : '';

            const contenedorPendientes = document.getElementById('nomina-pendientes');
            if (pendientesRamaActual.length) {
                document.getElementById('nomina-pendientes-lista').innerHTML = pendientesRamaActual.map(p => `
                    <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                        <span style="flex:1;">${escapeHtml(p.apellido)}, ${escapeHtml(p.nombre)} (DNI ${escapeHtml(p.dni)})</span>
                        <select class="form-control pendiente-rama-select" data-dni="${escapeHtml(p.dni)}" style="max-width:160px;" onchange="actualizarEstadoConfirmarNomina()">
                            <option value="">Elegir rama</option>
                            <option>Manada</option>
                            <option>Unidad</option>
                            <option>Caminantes</option>
                            <option>Rovers</option>
                        </select>
                    </div>
                `).join('');
                contenedorPendientes.classList.remove('hidden');
            } else {
                document.getElementById('nomina-pendientes-lista').innerHTML = '';
                contenedorPendientes.classList.add('hidden');
            }

            document.getElementById('nomina-preview').classList.remove('hidden');
            actualizarEstadoConfirmarNomina();
        }

        function actualizarEstadoConfirmarNomina() {
            const selects = document.querySelectorAll('.pendiente-rama-select');
            const faltaAlguno = Array.from(selects).some(s => !s.value);
            document.getElementById('btn-confirmar-nomina').disabled = filasNominaValidas.length === 0 || faltaAlguno;
        }
```

- [ ] **Step 3: Actualizar `cancelarCargaNomina` para limpiar los pendientes**

Reemplazar:
```js
        function cancelarCargaNomina() {
            filasNominaValidas = [];
            document.getElementById('nomina-archivo').value = '';
            document.getElementById('nomina-preview').classList.add('hidden');
        }
```

Por:
```js
        function cancelarCargaNomina() {
            filasNominaValidas = [];
            pendientesRamaActual = [];
            document.getElementById('nomina-archivo').value = '';
            document.getElementById('nomina-preview').classList.add('hidden');
            document.getElementById('nomina-pendientes').classList.add('hidden');
            document.getElementById('nomina-pendientes-lista').innerHTML = '';
        }
```

- [ ] **Step 4: Verificar la vista previa con pendientes en la consola**

En la misma consola de DevTools (después del Step 2 de Task 1), pegar:

```js
document.getElementById('beneficiarios-section').classList.remove('hidden');
mostrarVistaPreviaNomina(procesarFilasNomina([
  { Dni: '12345675', Nombre: 'Ledesma, Bruno', 'Función': 'Scout' },
  { Dni: '12345676', Nombre: 'Medina Torres, Delfina Abril', 'Función': 'Representante Juvenil de Grupo a la Asamblea Distrital' }
], {}));
document.getElementById('btn-confirmar-nomina').disabled
```
Expected: `true` (hay un pendiente sin rama elegida, aunque `filasNominaValidas` tenga 1 fila válida).

```js
document.querySelectorAll('.pendiente-rama-select').length
```
Expected: `1`.

```js
const select = document.querySelector('.pendiente-rama-select');
select.value = 'Caminantes';
select.dispatchEvent(new Event('change'));
document.getElementById('btn-confirmar-nomina').disabled
```
Expected: `false` (ya no falta ningún pendiente).

- [ ] **Step 5: Actualizar `confirmarCargaNomina` para incluir los pendientes resueltos y las nuevas excepciones**

Reemplazar:
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

Por:
```js
        async function confirmarCargaNomina() {
            if (!filasNominaValidas.length) return;

            const nuevasExcepciones = pendientesRamaActual.map(p => {
                const select = document.querySelector(`.pendiente-rama-select[data-dni="${p.dni}"]`);
                return { dni: p.dni, rama: select ? select.value : '' };
            });
            if (nuevasExcepciones.some(e => !e.rama)) return;

            const filasPendientesResueltas = pendientesRamaActual.map((p, i) =>
                [p.dni, p.apellido, p.nombre, nuevasExcepciones[i].rama]
            );
            const beneficiariosAEnviar = filasNominaValidas.concat(filasPendientesResueltas);

            if (!confirm(`Esto va a reemplazar los ${beneficiariosData.length} beneficiarios activos actuales por los ${beneficiariosAEnviar.length} de este archivo. ¿Continuar?`)) return;

            const btn = document.getElementById('btn-confirmar-nomina');
            btn.disabled = true;
            mostrarMensaje('nomina-mensaje-container', '💾 Actualizando beneficiarios...', 'info');
            try {
                const r = await api('actualizarBeneficiarios', { beneficiarios: beneficiariosAEnviar, nuevasExcepciones });
                beneficiariosData = beneficiariosAEnviar.map(f => [f[0], f[1], f[2], f[3]]);
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

- [ ] **Step 6: Verificar `confirmarCargaNomina` en la consola, mockeando `api()`**

En la misma sesión de consola (después del Step 4, con el `<select>` ya en `'Caminantes'`), pegar:

```js
window.confirm = () => true;
beneficiariosData = [];
configData = {};
api = async (accion, payload) => {
  console.log('llamada a', accion, payload);
  return { ok: true, total: payload.beneficiarios.length, porRama: { Manada: 0, Unidad: 1, Caminantes: 1, Rovers: 0, Educadores: 0 }, actualizadoEn: new Date().toISOString() };
};
await confirmarCargaNomina();
beneficiariosData;
```
Expected: la llamada logueada a `api` muestra `payload.beneficiarios` con 2 filas (Ledesma y Medina Torres con rama `'Caminantes'`) y `payload.nuevasExcepciones` = `[{ dni: '12345676', rama: 'Caminantes' }]`. `beneficiariosData` termina con esas mismas 2 filas.

(Después de este test, recargar la página — quedaron pisadas las funciones `confirm` y `api` globales.)

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar selector de rama para pendientes en la vista previa de la nómina"
```

---

### Task 3: Backend — guardar las nuevas excepciones al confirmar

**Files:**
- Modify: `backend/Code.gs:270-342` (agregar `validarNuevasExcepciones_`, extender `actualizarBeneficiarios_`)

**Interfaces:**
- Consumes: `p.nuevasExcepciones` (opcional, array `[{dni, rama}, ...]`, armado por el Task 2).
- Produces: `actualizarBeneficiarios_` ahora, además de reemplazar `BENEFICIARIOS`, agrega/actualiza las entradas de `p.nuevasExcepciones` en `CONFIG.excepciones_rama_dni` (mismo formato `dni:rama;dni:rama` que ya usa `parsearExcepcionesRama` en el frontend).

- [ ] **Step 1: Agregar `validarNuevasExcepciones_`**

Insertar justo antes de `function actualizarBeneficiarios_(p, user) {`:

```js
/** Valida (sin I/O) el array opcional de nuevas excepciones dni->rama que llega desde el cliente. */
function validarNuevasExcepciones_(nuevasExcepciones) {
  if (!Array.isArray(nuevasExcepciones) || !nuevasExcepciones.length) return [];
  const RAMAS_CHICOS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
  return nuevasExcepciones.map(function(ex) {
    const dni = String((ex && ex.dni) || '').trim();
    const rama = String((ex && ex.rama) || '').trim();
    if (!dni || !/^\d+$/.test(dni)) throw new Error('DNI inválido en nuevasExcepciones: ' + dni);
    if (RAMAS_CHICOS.indexOf(rama) < 0) throw new Error('Rama inválida en nuevasExcepciones para el DNI ' + dni + ': ' + rama);
    return { dni: dni, rama: rama };
  });
}
```

- [ ] **Step 2: Validar las excepciones antes del lock, y persistirlas dentro del lock**

Reemplazar:
```js
function actualizarBeneficiarios_(p, user) {
  const resultado = validarBeneficiarios_(p.beneficiarios);
  const ahora = new Date().toISOString();
```

Por:
```js
function actualizarBeneficiarios_(p, user) {
  const resultado = validarBeneficiarios_(p.beneficiarios);
  const nuevasExcepciones = validarNuevasExcepciones_(p.nuevasExcepciones);
  const ahora = new Date().toISOString();
```

Reemplazar:
```js
    const cfgValues = cfg.getDataRange().getValues();
    let escritoFecha = false, escritoUsuario = false;
    for (let i = 1; i < cfgValues.length; i++) {
      const clave = String(cfgValues[i][0] || '').trim();
      if (clave === 'beneficiarios_actualizado_en') {
        cfg.getRange(i + 1, 2).setValue(ahora);
        escritoFecha = true;
      } else if (clave === 'beneficiarios_actualizado_por') {
        cfg.getRange(i + 1, 2).setValue(user.email);
        escritoUsuario = true;
      }
    }
    if (!escritoFecha) cfg.appendRow(['beneficiarios_actualizado_en', ahora]);
    if (!escritoUsuario) cfg.appendRow(['beneficiarios_actualizado_por', user.email]);

    return { ok: true, total: resultado.filasValidas.length, porRama: resultado.porRama, actualizadoEn: ahora };
```

Por:
```js
    const cfgValues = cfg.getDataRange().getValues();
    let escritoFecha = false, escritoUsuario = false, indiceExcepciones = -1;
    for (let i = 1; i < cfgValues.length; i++) {
      const clave = String(cfgValues[i][0] || '').trim();
      if (clave === 'beneficiarios_actualizado_en') {
        cfg.getRange(i + 1, 2).setValue(ahora);
        escritoFecha = true;
      } else if (clave === 'beneficiarios_actualizado_por') {
        cfg.getRange(i + 1, 2).setValue(user.email);
        escritoUsuario = true;
      } else if (clave === 'excepciones_rama_dni') {
        indiceExcepciones = i;
      }
    }
    if (!escritoFecha) cfg.appendRow(['beneficiarios_actualizado_en', ahora]);
    if (!escritoUsuario) cfg.appendRow(['beneficiarios_actualizado_por', user.email]);

    if (nuevasExcepciones.length) {
      const mapaExcepciones = {};
      const valorActual = indiceExcepciones >= 0 ? String(cfgValues[indiceExcepciones][1] || '') : '';
      valorActual.split(';').forEach(function(par) {
        const partes = par.split(':');
        const dniPar = (partes[0] || '').trim();
        const ramaPar = (partes[1] || '').trim();
        if (dniPar && ramaPar) mapaExcepciones[dniPar] = ramaPar;
      });
      nuevasExcepciones.forEach(function(ex) { mapaExcepciones[ex.dni] = ex.rama; });
      const nuevoValor = Object.keys(mapaExcepciones).map(function(dniKey) {
        return dniKey + ':' + mapaExcepciones[dniKey];
      }).join(';');
      if (indiceExcepciones >= 0) cfg.getRange(indiceExcepciones + 1, 2).setValue(nuevoValor);
      else cfg.appendRow(['excepciones_rama_dni', nuevoValor]);
    }

    return { ok: true, total: resultado.filasValidas.length, porRama: resultado.porRama, actualizadoEn: ahora };
```

- [ ] **Step 3: Verificar (sin runner — inspección manual)**

Run: `grep -n "validarNuevasExcepciones_\|indiceExcepciones\|nuevasExcepciones" backend/Code.gs`
Expected: aparece la nueva función `validarNuevasExcepciones_`, y dentro de `actualizarBeneficiarios_` las referencias a `nuevasExcepciones` (parámetro validado) e `indiceExcepciones` (índice encontrado en el mismo loop que ya recorre `cfgValues`).

Revisar a ojo que:
- `validarNuevasExcepciones_` se llama ANTES del `lock.waitLock`, junto con `validarBeneficiarios_` — si el payload de excepciones es inválido, nada se llega a escribir (mismo principio que ya se aplica al resto de las validaciones de esta función).
- El nuevo bloque de excepciones reutiliza `cfgValues` (ya leído una sola vez) en vez de volver a leer la hoja `CONFIG`.

- [ ] **Step 4: Commit**

```bash
git add backend/Code.gs
git commit -m "feat: guardar nuevas excepciones de rama en CONFIG al confirmar la carga"
```

---

### Task 4: Documentar el paso manual pendiente

**Files:**
- Modify: `INSTRUCCIONES.md`

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1: Actualizar la sección de Beneficiarios**

Buscar el punto 2 existente en `INSTRUCCIONES.md` (el que documenta la excepción manual de un caso puntual detectado en la nómina real — buscar `"Excepción de rama para un caso puntual"`). Ese paso manual queda obsoleto con esta feature: ya no hace falta agregarlo a mano, la próxima carga de nómina la va a mostrar como pendiente y va a guardar la excepción sola al confirmar. Reemplazar ese punto por:

```markdown
2. **Excepción de rama para "Representante Juvenil" (ya no requiere paso manual):** antes había que agregar a mano en `CONFIG` la excepción de una beneficiaria detectada con este rol. Desde esta actualización, la vista previa de la carga detecta automáticamente cualquier fila cuya Función contenga "Representante Juvenil" sin excepción configurada, pide la rama real en un desplegable, y la guarda sola en `CONFIG.excepciones_rama_dni` al confirmar — no hace falta editar la planilla a mano para este caso ni para futuros similares.

   Mecanismo general (para revisar/editar excepciones a mano si hiciera falta): el valor de `excepciones_rama_dni` acepta varios DNI separados por `;`, cada uno con el formato `dni:rama` — por ejemplo `11111111:Caminantes;22222222:Rovers` (valores de ejemplo, no reales).
```

- [ ] **Step 2: Agregar el paso manual de deploy de esta feature**

Al final de la sección `## Pendiente: Carga de Nómina para Beneficiarios`, después del punto 4 existente (el de aceptar "Educadores"), agregar:

```markdown

5. **Preguntar rama para "Representante Juvenil" (paso manual pendiente):** en el editor de Apps Script, agregar la función `validarNuevasExcepciones_` y actualizar `actualizarBeneficiarios_` para que acepte y guarde `nuevasExcepciones` (ver `backend/Code.gs`) → Implementar → Administrar implementaciones → editar la implementación existente → Nueva versión → Implementar. Sin este paso, confirmar una carga con pendientes resueltos va a guardar los beneficiarios correctamente pero **no** va a persistir la excepción nueva en `CONFIG` — la próxima carga volvería a preguntar por la misma persona.
```

- [ ] **Step 3: Commit**

```bash
git add INSTRUCCIONES.md
git commit -m "docs: actualizar instrucciones para preguntar rama de Representante Juvenil"
```

## Self-Review

**Spec coverage:** detección de "representante juvenil" case-insensitive por substring, sin match exacto ni prefijo anclado (Task 1); el DNI con otra fila que resuelve rama gana, sin importar el orden (Task 1, mismo mecanismo que el desempate de duplicados ya existente); selector de rama por pendiente en la vista previa, sin opción "Educadores" ni de saltear (Task 2); botón de confirmar bloqueado hasta que todos los pendientes tengan rama (Task 2); persistencia de la excepción nueva en `CONFIG.excepciones_rama_dni` en el mismo formato existente, agregando sin duplicar (Task 3); paso manual de deploy documentado, y el paso manual viejo (excepción manual a mano) marcado como obsoleto (Task 4). Todo lo del spec está cubierto.

**Placeholders:** ninguno — todos los pasos tienen código completo y verificaciones con salida esperada concreta.

**Consistencia de tipos:** `procesarFilasNomina` devuelve `pendientesRama: Array<{dni, apellido, nombre}>` (Task 1), consumido igual por `mostrarVistaPreviaNomina`/`pendientesRamaActual` (Task 2). El payload `nuevasExcepciones: [{dni, rama}, ...]` que arma `confirmarCargaNomina` (Task 2) es exactamente lo que espera `validarNuevasExcepciones_` en el backend (Task 3: `ex.dni`, `ex.rama`). El formato de `CONFIG.excepciones_rama_dni` (`dni:rama;dni:rama`) es el mismo que ya parsea `parsearExcepcionesRama` en el frontend — no se introduce un formato nuevo.

## Desviaciones respecto al plan original

**`procesarFilasNomina` — precedencia de "rama confirmada" y limpieza de `validas` (Task 1):** la revisión de esta tarea encontró que el código original de este plan (Step 1) usaba `indicePorDni` para decidir si un candidato a pendiente ya estaba resuelto por otra fila — pero esa condición también incluía filas resueltas solo por el fallback genérico a "Educadores", que no es una señal confiable de rama confirmada. La versión final agrega un `Set` `dnisConRamaConfirmada` que solo se completa cuando la rama vino de una excepción o de un match exacto de Función (nunca del fallback), y usa ese Set para el filtro de `pendientesRama`. Además, y por fuera del código literal que traía este plan, se agregó un paso de limpieza posterior al loop principal: si un DNI termina en `pendientesRama`, cualquier entrada suya en `validas` (colada ahí solo por el fallback genérico) se saca y se descuenta de `porRama` — sin este paso, ese DNI quedaba simultáneamente en `validas` (como "Educadores") y en `pendientesRama`, y al confirmar la carga el backend rechazaba todo el envío con "DNI repetido en la carga". Verificado con casos de 3+ personas y remoción en el medio del array (iteración hacia atrás con `splice`, patrón seguro). Ver `.superpowers/sdd/task-1-report.md` para el detalle completo.

**Filas de "Representante Juvenil" malformadas ahora cuentan como error (Task 1):** el código original de este plan las descartaba en silencio (sin incrementar ningún contador) si el DNI era inválido o el nombre no tenía coma. La versión final las suma a `errores`, igual que cualquier otra fila malformada de la función — así los contadores de la vista previa (`porRama` + `descartadas` + `errores`) siempre concilian contra el total de filas del archivo.
