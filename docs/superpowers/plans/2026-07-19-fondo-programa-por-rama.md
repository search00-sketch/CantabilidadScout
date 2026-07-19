# Fondo de Programa por Rama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discriminar el gasto de Rubro="Programa" por rama y mostrar en el dashboard el fondo restante de cada una de las 4 ramas (Manada, Unidad, Caminantes, Rovers), calculado como $10.000 por beneficiario activo de la rama menos lo gastado en Programa.

**Architecture:** Se agrega una columna "Rama" a la hoja `EGRESOS` (solo se completa cuando Rubro="Programa") y una fila de config `monto_programa_por_beneficiario=10000`. El backend (Apps Script) solo escribe/lee ese dato crudo — no calcula nada. Todo el cálculo (fondo asignado, gastado, restante por rama) vive en el cliente (`public/index.html`), igual que el resto de los cálculos del dashboard (saldo total, deudores), y se renderiza en la card que hoy es "PENDIENTE DE COBRO".

**Tech Stack:** Google Apps Script (backend), HTML/CSS/JS vanilla sin build step (frontend, un solo archivo `public/index.html`), Google Sheets como base de datos.

## Global Constraints

- Solo los egresos con Rubro="Programa" descuentan del fondo de una rama. El resto de los rubros no participa de este cálculo.
- Tasa única global (`monto_programa_por_beneficiario`), aplicada por igual a las 4 ramas: Manada, Unidad, Caminantes, Rovers.
- El fondo es acumulado histórico — no se filtra por período.
- Toda la lógica de cálculo vive en el cliente; el backend (Apps Script) solo entrega/guarda datos crudos.
- Este proyecto no tiene framework de tests (frontend estático de un solo archivo, sin build step; backend Apps Script sin runner local). La verificación de cada tarea es manual: inspección de código (grep/diff) para el backend, y consola del navegador para el frontend — no hay `npm test` ni equivalente. Esto es consistente con el resto del código existente (tampoco tiene tests).
- `backend/Code.gs` en este repo es una **copia** del backend real, que vive desplegado en el editor de Apps Script de la planilla. Los cambios de este plan se aplican primero acá (repo) y después deben pegarse a mano en el Apps Script real y redesplegarse como **nueva versión** — si no, el Web App sigue sirviendo el código viejo.

---

### Task 1: Backend — Rama en EGRESOS (escritura y lectura)

**Files:**
- Modify: `backend/Code.gs:258-272` (`addEgreso_`)
- Modify: `backend/Code.gs:184-190` (`getMovimientos_`, loop de egresos)

**Interfaces:**
- Consumes: nada nuevo — usa `num_()` y `leer_()` ya existentes en el archivo (no se tocan).
- Produces: `addEgreso_` ahora acepta `p.rama` (string) y lo exige si `p.rubro === 'Programa'`. La hoja `EGRESOS` pasa a tener una 9ª columna (I) = Rama. `getMovimientos_().egresos` — cada fila pasa a tener un 7° elemento (`row[6]`) = rama (string, `''` si no aplica). Esto lo consume el Task 3.

- [ ] **Step 1: Editar `addEgreso_` para validar y guardar la rama**

Reemplazar:
```js
function addEgreso_(p, user) {
  const monto = num_(p.monto);
  if (!p.fecha || !p.rubro || !(monto > 0)) throw new Error('Faltan campos obligatorios');

  let linkArchivo = '';
  if (p.archivo && p.archivo.base64) {
    linkArchivo = subirArchivo_(p.archivo, FOLDER_EGRESOS);
  }

  ss_().getSheetByName('EGRESOS').appendRow([
    p.fecha, String(p.rubro), String(p.detalle || ''), String(p.comprobante || ''),
    monto, linkArchivo, user.email, new Date().toISOString()
  ]);
  return { ok: true, linkArchivo: linkArchivo };
}
```

Por:
```js
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
```

- [ ] **Step 2: Editar `getMovimientos_` para devolver la rama de cada egreso**

Reemplazar:
```js
  const egresos = [];
  for (let i = 1; i < egr.length; i++) {
    const r = egr[i];
    if (!r[0] && !r[4]) continue;
    egresos.push([toISO_(r[0]), String(r[1] || ''), String(r[2] || ''),
                  String(r[3] || ''), num_(r[4]), String(r[5] || '')]);
  }
```

Por:
```js
  const egresos = [];
  for (let i = 1; i < egr.length; i++) {
    const r = egr[i];
    if (!r[0] && !r[4]) continue;
    egresos.push([toISO_(r[0]), String(r[1] || ''), String(r[2] || ''),
                  String(r[3] || ''), num_(r[4]), String(r[5] || ''), String(r[8] || '')]);
  }
```

- [ ] **Step 3: Verificar (sin runner — inspección manual)**

Run: `grep -n "rama" backend/Code.gs`
Expected: aparecen las líneas de `addEgreso_` (validación + appendRow) y de `getMovimientos_` (el nuevo `String(r[8] || '')`). Confirmar a ojo que `appendRow` tiene ahora 9 elementos en el array y que el índice `r[8]` corresponde a la columna I (A=0…I=8).

- [ ] **Step 4: Commit**

```bash
git add backend/Code.gs
git commit -m "feat: agregar rama a egresos de Programa (backend)"
```

---

### Task 2: Frontend — Campo Rama en el formulario de Egreso

**Files:**
- Modify: `public/index.html:369-389` (form de egreso — select de rubro + bloque nuevo de rama)
- Modify: `public/index.html` (función `guardarEgreso`, bloque de lectura de campos ~línea 1109-1119, validación ~1116-1119, llamada a la API ~1135, reset ~1138-1139)

**Interfaces:**
- Consumes: ninguna interfaz nueva de otras tareas de este plan (usa `mostrarMensaje()`, `api()` ya existentes).
- Produces: `toggleCampoRamaEgreso()` (función global, sin retorno, togglea `.hidden` en `#campo-rama-egreso`). `guardarEgreso()` ahora manda `rama` en el payload de `addEgreso` — lo consume el Task 1 (backend) una vez desplegado.

- [ ] **Step 1: Agregar el campo Rama al formulario (oculto salvo Rubro="Programa")**

Reemplazar:
```html
                            <div class="grid">
                                <div class="form-group"><label for="egreso-fecha">Fecha *</label><input type="date" id="egreso-fecha" class="form-control" required aria-required="true"></div>
                                <div class="form-group"><label for="egreso-rubro">Rubro *</label>
                                    <select id="egreso-rubro" class="form-control" required aria-required="true">
                                        <option value="">Seleccionar</option>
                                        <option value="Mantenimiento">Mantenimiento</option>
                                        <option value="Programa">Programa</option>
                                        <option value="Limpieza">Limpieza</option>
                                        <option value="Merienda">Merienda</option>
                                        <option value="Campamento">Campamento</option>
                                        <option value="Eventos">Eventos</option>
                                        <option value="Formación">Formación</option>
                                        <option value="Donaciones">Donaciones</option>
                                        <option value="Proveduría">Proveduría</option>
                                        <option value="Librería">Librería</option>
                                        <option value="Distrito">Distrito</option>
                                        <option value="Viáticos">Viáticos</option>
                                        <option value="Farmacia">Farmacia</option>
                                        <option value="Premios/Regalos">Premios/Regalos</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group"><label for="egreso-detalle">Detalle *</label><input type="text" id="egreso-detalle" class="form-control" required aria-required="true"></div>
```

Por:
```html
                            <div class="grid">
                                <div class="form-group"><label for="egreso-fecha">Fecha *</label><input type="date" id="egreso-fecha" class="form-control" required aria-required="true"></div>
                                <div class="form-group"><label for="egreso-rubro">Rubro *</label>
                                    <select id="egreso-rubro" class="form-control" required aria-required="true" onchange="toggleCampoRamaEgreso()">
                                        <option value="">Seleccionar</option>
                                        <option value="Mantenimiento">Mantenimiento</option>
                                        <option value="Programa">Programa</option>
                                        <option value="Limpieza">Limpieza</option>
                                        <option value="Merienda">Merienda</option>
                                        <option value="Campamento">Campamento</option>
                                        <option value="Eventos">Eventos</option>
                                        <option value="Formación">Formación</option>
                                        <option value="Donaciones">Donaciones</option>
                                        <option value="Proveduría">Proveduría</option>
                                        <option value="Librería">Librería</option>
                                        <option value="Distrito">Distrito</option>
                                        <option value="Viáticos">Viáticos</option>
                                        <option value="Farmacia">Farmacia</option>
                                        <option value="Premios/Regalos">Premios/Regalos</option>
                                    </select>
                                </div>
                            </div>
                            <div id="campo-rama-egreso" class="hidden">
                                <div class="form-group"><label for="egreso-rama">Rama *</label>
                                    <select id="egreso-rama" class="form-control">
                                        <option value="">Seleccionar</option>
                                        <option>Manada</option>
                                        <option>Unidad</option>
                                        <option>Caminantes</option>
                                        <option>Rovers</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group"><label for="egreso-detalle">Detalle *</label><input type="text" id="egreso-detalle" class="form-control" required aria-required="true"></div>
```

- [ ] **Step 2: Agregar la función `toggleCampoRamaEgreso()`**

Ubicarla junto a `toggleCamposBeneficiario()` (busca esa función en `public/index.html` con `grep -n "function toggleCamposBeneficiario" public/index.html` para insertar justo después de su cierre). Agregar:

```js
        function toggleCampoRamaEgreso() {
            const rubro = document.getElementById('egreso-rubro').value;
            document.getElementById('campo-rama-egreso').classList.toggle('hidden', rubro !== 'Programa');
        }
```

- [ ] **Step 3: Leer, validar y enviar la rama en `guardarEgreso()`**

Reemplazar:
```js
                const comprobante = document.getElementById('egreso-comprobante').value;
                const archivoInput = document.getElementById('egreso-archivo').files[0];

                if (!fecha || !rubro || !monto) {
                    mostrarMensaje('egreso-mensaje-container', 'Completá los campos obligatorios', 'error');
                    return false;
                }
```

Por:
```js
                const comprobante = document.getElementById('egreso-comprobante').value;
                const rama = document.getElementById('egreso-rama').value;
                const archivoInput = document.getElementById('egreso-archivo').files[0];

                if (!fecha || !rubro || !monto) {
                    mostrarMensaje('egreso-mensaje-container', 'Completá los campos obligatorios', 'error');
                    return false;
                }
                if (rubro === 'Programa' && !rama) {
                    mostrarMensaje('egreso-mensaje-container', 'Seleccioná la rama del gasto de Programa', 'error');
                    return false;
                }
```

Reemplazar:
```js
                const r = await api('addEgreso', { fecha, rubro, detalle, comprobante, monto, archivo });
```

Por:
```js
                const r = await api('addEgreso', { fecha, rubro, detalle, comprobante, monto, archivo, rama });
```

Reemplazar:
```js
                document.getElementById('form-egreso').reset();
                document.getElementById('egreso-file-info').classList.add('hidden');
```

Por:
```js
                document.getElementById('form-egreso').reset();
                document.getElementById('egreso-file-info').classList.add('hidden');
                document.getElementById('campo-rama-egreso').classList.add('hidden');
```

- [ ] **Step 4: Verificar en el navegador (sin login, sin backend)**

Abrir `public/index.html` directamente en el navegador (doble clic, o `start public/index.html` en la terminal). Abrir la consola de DevTools y pegar:

```js
document.getElementById('egreso-rubro').value = 'Programa';
document.getElementById('egreso-rubro').dispatchEvent(new Event('change'));
document.getElementById('campo-rama-egreso').classList.contains('hidden')
```
Expected: `false`

```js
document.getElementById('egreso-rubro').value = 'Mantenimiento';
document.getElementById('egreso-rubro').dispatchEvent(new Event('change'));
document.getElementById('campo-rama-egreso').classList.contains('hidden')
```
Expected: `true`

(Esto funciona sin login porque el elemento existe en el DOM aunque la sección esté oculta con CSS — no hace falta llegar al dashboard real.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar campo Rama al formulario de Egreso para gastos de Programa"
```

---

### Task 3: Frontend — Card "Fondo de Programa por Rama" en el Dashboard

**Files:**
- Modify: `public/index.html:287-290` (grid de stat-cards del dashboard)
- Modify: `public/index.html` (función `cargarSaldos`, agregar `calcularFondosPorRama` y `cargarFondosPorRama` justo después)

**Interfaces:**
- Consumes: `movimientos.egresos` con `row[6]` = rama (producido por Task 1 una vez desplegado el backend real; en el cliente el campo ya existe apenas se actualiza `getMovimientos_`), `beneficiariosData` (global existente, filas `[id, apellido, nombre, rama]`), `configData['monto_programa_por_beneficiario']` (global existente, viene de la fila de CONFIG que se agrega a mano en la planilla), `numConfig()` y `escapeHtml()` (helpers ya existentes).
- Produces: `calcularFondosPorRama()` → `Array<{rama: string, asignado: number, gastado: number, restante: number}>` (4 elementos, uno por rama, en orden Manada/Unidad/Caminantes/Rovers). `cargarFondosPorRama()` → sin retorno, escribe en `#fondos-rama`.

- [ ] **Step 1: Reemplazar la card "PENDIENTE DE COBRO" por la card de fondo por rama**

Reemplazar:
```html
                    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                        <article class="stat-card"><h3 style="font-size: 0.85rem;">TOTAL ACTIVOS</h3><div class="stat-number" id="saldo-total" style="font-size: 2rem;">$ ...</div><small>Saldo inicial ± movimientos</small></article>
                        <article class="stat-card"><h3 style="font-size: 0.85rem;">PENDIENTE DE COBRO</h3><div class="stat-number" id="total-pendiente" style="color: var(--error);">$ 0</div><small id="familias-al-dia">Calculando...</small></article>
                    </div>
```

Por:
```html
                    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                        <article class="stat-card"><h3 style="font-size: 0.85rem;">TOTAL ACTIVOS</h3><div class="stat-number" id="saldo-total" style="font-size: 2rem;">$ ...</div><small>Saldo inicial ± movimientos</small></article>
                        <article class="stat-card" style="text-align:left;">
                            <h3 style="font-size: 0.85rem; text-align:center;">FONDO DE PROGRAMA POR RAMA</h3>
                            <div id="fondos-rama" style="font-size: 0.8rem; margin-top: 8px;">Calculando...</div>
                        </article>
                    </div>
```

- [ ] **Step 2: Quitar de `cargarSaldos()` las líneas que ya no tienen dónde escribir, y agregar la llamada a `cargarFondosPorRama()`**

Reemplazar:
```js
            const estados = calcularEstadosBeneficiarios();

            // Pendiente de cobro + familias al día
            const totalPendiente = estados.reduce((s, e) => s + e.totalPendiente, 0);
            const alDia = estados.filter(e => e.totalPendiente === 0).length;
            document.getElementById('total-pendiente').textContent = `$ ${totalPendiente.toLocaleString('es-AR')}`;
            document.getElementById('familias-al-dia').textContent = `${alDia} de ${estados.length} al día`;

            // Anotados al Campamento de Verano (pagaron algo)
```

Por:
```js
            const estados = calcularEstadosBeneficiarios();

            // Anotados al Campamento de Verano (pagaron algo)
```

Y reemplazar el cierre de la función:
```js
            tbody.innerHTML = html || '<tr><td colspan="4" class="text-center">Todavía no hay anotados</td></tr>';
        }
```

Por:
```js
            tbody.innerHTML = html || '<tr><td colspan="4" class="text-center">Todavía no hay anotados</td></tr>';

            cargarFondosPorRama();
        }

        function calcularFondosPorRama() {
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
            const tasa = numConfig('monto_programa_por_beneficiario', 0);
            const conteo = {}, gasto = {};
            beneficiariosData.forEach(b => {
                const r = String(b[3] || '').trim();
                conteo[r] = (conteo[r] || 0) + 1;
            });
            movimientos.egresos.forEach(row => {
                if (String(row[1] || '') !== 'Programa') return;
                const r = String(row[6] || '').trim();
                if (r) gasto[r] = (gasto[r] || 0) + (Number(row[4]) || 0);
            });
            return RAMAS.map(r => {
                const asignado = tasa * (conteo[r] || 0);
                const gastado = gasto[r] || 0;
                return { rama: r, asignado, gastado, restante: asignado - gastado };
            });
        }

        function cargarFondosPorRama() {
            document.getElementById('fondos-rama').innerHTML = calcularFondosPorRama().map(d => {
                const color = d.restante < 0 ? 'var(--error)' : 'var(--negro)';
                return `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                            <span>${escapeHtml(d.rama)}</span>
                            <span style="color:${color};font-weight:600;">$${d.restante.toLocaleString('es-AR')}</span>
                        </div>`;
            }).join('');
        }
```

- [ ] **Step 3: Verificar en el navegador (sin login, con datos simulados)**

Abrir `public/index.html` en el navegador, abrir la consola y pegar (en una sola sesión, en orden):

```js
beneficiariosData = [
  ['1','Pérez','Juan','Manada'],
  ['2','Gómez','Ana','Manada'],
  ['3','Ruiz','Leo','Unidad']
];
movimientos = { ingresos: [], egresos: [
  ['2026-01-10','Programa','Materiales manada','',5000,'','Manada'],
  ['2026-02-01','Mantenimiento','Pintura','',3000,'','']
]};
configData = { monto_programa_por_beneficiario: 10000 };
calcularFondosPorRama();
```
Expected (array de 4, en este orden):
```js
[
  { rama: 'Manada', asignado: 20000, gastado: 5000, restante: 15000 },
  { rama: 'Unidad', asignado: 10000, gastado: 0, restante: 10000 },
  { rama: 'Caminantes', asignado: 0, gastado: 0, restante: 0 },
  { rama: 'Rovers', asignado: 0, gastado: 0, restante: 0 }
]
```

Luego:
```js
cargarFondosPorRama();
document.getElementById('fondos-rama').textContent
```
Expected: el texto contiene `Manada` seguido de `$15.000`, y `Unidad` seguido de `$10.000` (formato `toLocaleString('es-AR')`).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: mostrar fondo de Programa restante por rama en el dashboard"
```

---

### Task 4: Documentar los pasos manuales pendientes

**Files:**
- Modify: `INSTRUCCIONES.md`

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1: Agregar una sección de pendientes específica de esta feature**

Al final de `INSTRUCCIONES.md`, después de la sección `## Pendientes para una próxima etapa` existente, agregar:

```markdown

## Pendiente: Fondo de Programa por Rama

Cambios de código ya hechos en este repo (backend/Code.gs y public/index.html). Faltan estos 3 pasos manuales para que tengan efecto:

1. En la planilla → hoja EGRESOS → agregar el encabezado "Rama" en la celda I1.
2. En la planilla → hoja CONFIG → agregar la fila: `monto_programa_por_beneficiario` | `10000`.
3. En el editor de Apps Script (Extensiones → Apps Script desde la planilla) → reemplazar `addEgreso_` y el loop de egresos de `getMovimientos_` con el contenido de `backend/Code.gs` → Implementar → Administrar implementaciones → editar la implementación existente → Nueva versión → Implementar.

Después de estos 3 pasos, hacer `firebase deploy --only hosting` para publicar el `index.html` actualizado.
```

- [ ] **Step 2: Commit**

```bash
git add INSTRUCCIONES.md
git commit -m "docs: agregar pasos manuales pendientes para fondo de programa por rama"
```

## Self-Review

**Spec coverage:** columna Rama en EGRESOS (Task 1), fila CONFIG (Task 4, documentado como paso manual — no se puede escribir la planilla desde este repo), validación backend (Task 1), campo Rama condicional en el form de Egreso (Task 2), reemplazo de la card "Pendiente de cobro" (Task 3), cálculo cliente-side (Task 3), pasos manuales de despliegue (Task 4). Todo lo del spec está cubierto.

**Placeholders:** ninguno — todos los pasos tienen código completo y comandos de verificación con salida esperada concreta.

**Consistencia de tipos:** `row[6]` (rama en egresos) se define en Task 1 y se consume igual en Task 3. `beneficiariosData` con `b[3]` = rama es el formato ya existente en el código (usado igual en `calcularEstadosBeneficiarios`), no se inventa un formato nuevo. `calcularFondosPorRama()` y `cargarFondosPorRama()` se nombran igual en su definición (Task 3) y en su único punto de uso (llamada agregada al final de `cargarSaldos()`, también en Task 3).
