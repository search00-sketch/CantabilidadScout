# Incluir Educadores en la Carga de Nómina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los educadores/dirigentes (excluyendo "Padre representante...") queden cargados como beneficiarios bajo una categoría única "Educadores" al subir la nómina, para poder cobrarles campamento sin afectar el cálculo de cuota/afiliación.

**Architecture:** Todo el cambio de clasificación vive en el cliente (`procesarFilasNomina`, `public/index.html`), igual que el resto de la lógica de la carga de nómina. El backend solo necesita aceptar "Educadores" como rama válida en su whitelist de validación — no calcula nada nuevo. La lógica de cobro existente (`calcularEstadosBeneficiarios`) no se toca: ya excluye de la cuota a cualquier rama fuera de `CONFIG.ramas_afiliacion`, y ya no filtra el campamento por rama.

**Tech Stack:** Google Apps Script (backend), HTML/CSS/JS vanilla sin build step (frontend, un solo archivo `public/index.html`), Google Sheets como base de datos.

## Global Constraints

- Este proyecto no tiene framework de tests. La verificación de cada tarea es manual: inspección de código (grep) para el backend, y consola del navegador para el frontend.
- `backend/Code.gs` en este repo es una **copia** del backend real; los cambios se aplican primero acá y después se pegan a mano en el Apps Script real, redesplegando como **nueva versión**.
- Regla de clasificación: Función es una de las 4 ramas (`Lobato / Lobezna`, `Scout`, `Caminante`, `Rover`) → esa rama, igual que hoy. Función vacía → se descarta. Función no vacía que empieza con "Padre representante" (sin distinguir mayúsculas/minúsculas) → se descarta. Cualquier otra Función no vacía → rama = `Educadores`.
- Las excepciones por DNI (`CONFIG.excepciones_rama_dni`) se siguen evaluando primero y ganan por encima de esta regla — no se tocan.
- Todos los educadores comparten una única categoría `Educadores` (no se distingue a qué rama de chicos pertenece cada uno) — confirmado con el usuario.
- No se modifica el cálculo de fondo de Programa por rama (`calcularFondosPorRama`, ya mergeado a `master`): sigue iterando solo sobre las 4 ramas de chicos, `Educadores` no participa ahí.
- No se agrega ningún monto o cuota nueva para educadores: pagan campamento con los mismos valores de `CONFIG` que ya existen.

---

### Task 1: Frontend — clasificar educadores en `procesarFilasNomina` y mostrarlos en la UI

**Files:**
- Modify: `public/index.html:732-736` (agregar `esFuncionEducador`, actualizar `RAMAS_VALIDAS`)
- Modify: `public/index.html:757-768` (`procesarFilasNomina` — `porRama` inicial y resolución de `rama`)
- Modify: `public/index.html:840-842` (`mostrarVistaPreviaNomina` — agregar fila "Educadores" a la vista previa)
- Modify: `public/index.html:431` (select `#filtro-rama` en Deudores — agregar opción "Educadores")

**Interfaces:**
- Consumes: `FUNCION_A_RAMA` (ya existente, sin cambios).
- Produces: `esFuncionEducador(funcion)` → `boolean` — función pura, la usa `procesarFilasNomina` en este mismo task. `procesarFilasNomina` ahora puede devolver `rama: 'Educadores'` en las filas de `validas`, y `porRama.Educadores` (número) en el resultado — lo consume `mostrarVistaPreviaNomina` (este task) y, más adelante, cualquier vista que lea `beneficiariosData`/Deudores (ya genéricas, sin cambios necesarios).

- [ ] **Step 1: Agregar `esFuncionEducador` y actualizar `RAMAS_VALIDAS`**

Reemplazar:
```js
        // Object.create(null): sin prototipo, así una Función/DNI igual a "constructor" o "toString"
        // no resuelve a un método heredado en vez de dar "no encontrado".
        const FUNCION_A_RAMA = Object.assign(Object.create(null),
            { 'Lobato / Lobezna': 'Manada', 'Scout': 'Unidad', 'Caminante': 'Caminantes', 'Rover': 'Rovers' });
        const RAMAS_VALIDAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
```

Por:
```js
        // Object.create(null): sin prototipo, así una Función/DNI igual a "constructor" o "toString"
        // no resuelve a un método heredado en vez de dar "no encontrado".
        const FUNCION_A_RAMA = Object.assign(Object.create(null),
            { 'Lobato / Lobezna': 'Manada', 'Scout': 'Unidad', 'Caminante': 'Caminantes', 'Rover': 'Rovers' });
        const RAMAS_VALIDAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers', 'Educadores'];

        // Cualquier Función no vacía que no sea una de las 4 ramas ni un "Padre representante..."
        // cuenta como educador/dirigente (pero no como beneficiario de ninguna rama puntual).
        function esFuncionEducador(funcion) {
            return !!funcion && !/^padre representante/i.test(funcion);
        }
```

- [ ] **Step 2: Actualizar `procesarFilasNomina` para clasificar educadores**

Reemplazar:
```js
        function procesarFilasNomina(filas, excepcionesRama) {
            const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0 };
            const indicePorDni = new Map();
            const validas = [];
            let descartadas = 0, errores = 0, duplicados = 0;

            filas.forEach(f => {
                const dni = String(f['Dni'] || '').trim();
                const nombreCompleto = String(f['Nombre'] || '').trim();
                const funcion = String(f['Función'] || '').trim();
                const rama = (excepcionesRama || Object.create(null))[dni] || FUNCION_A_RAMA[funcion];
                if (!rama) { descartadas++; return; }
```

Por:
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
```

(El resto de la función —split de nombre, dedupe por DNI, conteo por rama— queda igual, ya es genérico respecto al valor de `rama`.)

- [ ] **Step 3: Verificar `esFuncionEducador` y `procesarFilasNomina` en la consola del navegador (sin login)**

Abrir `public/index.html` directamente en el navegador. Consola de DevTools:

```js
esFuncionEducador('Sub-Jefe de Grupo')
esFuncionEducador('Padre representante Unidad Scout')
esFuncionEducador('padre representante comunidad rover')
esFuncionEducador('')
```
Expected: `true`, `false`, `false`, `false` (en ese orden — la comparación con "Padre representante" no distingue mayúsculas/minúsculas).

```js
procesarFilasNomina([
  { Dni: '12345673', Nombre: 'Funes, Ricardo Omar', 'Función': 'Sub-Jefe de Grupo' },
  { Dni: '12345674', Nombre: 'Peralta, Silvia Noemi', 'Función': 'Padre representante Comunidad Rover' },
  { Dni: '12345675', Nombre: 'Ledesma, Bruno', 'Función': 'Scout' },
  { Dni: '99999999', Nombre: 'Sin Funcion, Test', 'Función': '' }
], {})
```
Expected:
```js
{
  validas: [ ['12345673','Funes','Ricardo Omar','Educadores'], ['12345675','Ledesma','Bruno','Unidad'] ],
  porRama: { Manada: 0, Unidad: 1, Caminantes: 0, Rovers: 0, Educadores: 1 },
  descartadas: 2,   // Peralta (Padre representante) y la fila con Función vacía
  errores: 0,
  duplicados: 0
}
```

- [ ] **Step 4: Agregar la fila "Educadores" a la vista previa de la carga**

Reemplazar:
```js
        function mostrarVistaPreviaNomina(resultado) {
            filasNominaValidas = resultado.validas;
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
```

Por:
```js
        function mostrarVistaPreviaNomina(resultado) {
            filasNominaValidas = resultado.validas;
            const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers', 'Educadores'];
```

- [ ] **Step 5: Agregar la opción "Educadores" al filtro de rama en Deudores**

Reemplazar:
```html
                            <div class="filter-group"><label for="filtro-rama">Rama:</label><select id="filtro-rama" class="form-control" onchange="filtrarDeudores()"><option value="TODAS">Todas</option><option>Manada</option><option>Unidad</option><option>Caminantes</option><option>Rovers</option></select></div>
```

Por:
```html
                            <div class="filter-group"><label for="filtro-rama">Rama:</label><select id="filtro-rama" class="form-control" onchange="filtrarDeudores()"><option value="TODAS">Todas</option><option>Manada</option><option>Unidad</option><option>Caminantes</option><option>Rovers</option><option>Educadores</option></select></div>
```

- [ ] **Step 6: Verificar la vista previa y el filtro en la consola**

En la misma consola de DevTools (después del Step 3), pegar:

```js
mostrarVistaPreviaNomina(procesarFilasNomina([
  { Dni: '12345673', Nombre: 'Funes, Ricardo Omar', 'Función': 'Sub-Jefe de Grupo' }
], {}));
document.getElementById('nomina-preview-tbody').textContent
```
Expected: el texto incluye `Educadores` y `1` (una fila más que antes en la tabla de conteos).

```js
document.getElementById('filtro-rama').innerHTML
```
Expected: incluye `<option>Educadores</option>` al final de las opciones.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: incluir educadores/dirigentes como beneficiarios al cargar la nómina"
```

---

### Task 2: Backend — aceptar "Educadores" como rama válida

**Files:**
- Modify: `backend/Code.gs:272` (`validarBeneficiarios_`, array `RAMAS`)
- Modify: `backend/Code.gs:275` (`validarBeneficiarios_`, objeto inicial `porRama`)

**Interfaces:**
- Consumes: ninguna interfaz nueva.
- Produces: `validarBeneficiarios_` ahora acepta `'Educadores'` como valor válido de rama en el payload que ya arma el Task 1 (`[dni, apellido, nombre, rama]`), además de las 4 ramas existentes, y su `porRama` de retorno incluye la clave `Educadores`.

- [ ] **Step 1: Ampliar la whitelist de ramas y el objeto `porRama`**

Reemplazar:
```js
  const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers'];
  if (!Array.isArray(filas) || !filas.length) throw new Error('No se recibió ningún beneficiario para cargar');

  const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0 };
```

Por:
```js
  const RAMAS = ['Manada', 'Unidad', 'Caminantes', 'Rovers', 'Educadores'];
  if (!Array.isArray(filas) || !filas.length) throw new Error('No se recibió ningún beneficiario para cargar');

  const porRama = { Manada: 0, Unidad: 0, Caminantes: 0, Rovers: 0, Educadores: 0 };
```

Nota: si solo se agrega `'Educadores'` a `RAMAS` sin agregar `Educadores: 0` a `porRama`, `porRama['Educadores']++` sobre una clave inexistente da `NaN` (no `1`) — hay que cambiar las dos líneas juntas.

- [ ] **Step 2: Verificar (sin runner — inspección manual)**

Run: `grep -n "const RAMAS = \[\|const porRama = {" backend/Code.gs`
Expected: ambas líneas muestran `Educadores` (la primera como `'Educadores'` en el array, la segunda como `Educadores: 0` en el objeto).

Revisar a ojo que ninguna otra parte de `backend/Code.gs` asuma que la rama de un beneficiario es una de solo 4 valores (`grep -n "Manada\|Unidad\|Caminantes\|Rovers" backend/Code.gs` — los únicos resultados esperados son estas dos líneas; el resto del backend no filtra ni calcula nada por rama de beneficiario).

- [ ] **Step 3: Commit**

```bash
git add backend/Code.gs
git commit -m "feat: aceptar Educadores como rama válida al validar la carga de beneficiarios"
```

---

### Task 3: Documentar el paso manual pendiente

**Files:**
- Modify: `INSTRUCCIONES.md`

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1: Agregar el paso manual a la sección existente de Beneficiarios**

Buscar la sección `## Pendiente: Carga de Nómina para Beneficiarios` en `INSTRUCCIONES.md` (agregada por el plan anterior) y agregar, después del punto 3 existente (el de duplicar `BENEFICIARIOS` como respaldo) y antes de la línea final de `firebase deploy`:

```markdown

4. **Educadores como beneficiarios (paso manual pendiente):** en el editor de Apps Script, ampliar el array `RAMAS` de `validarBeneficiarios_` para que acepte también `'Educadores'` (ver `backend/Code.gs`) → Implementar → Administrar implementaciones → editar la implementación existente → Nueva versión → Implementar. Sin este paso, la carga de nómina va a rechazar con "Rama inválida" a cualquier educador/dirigente reconocido por el frontend.
```

- [ ] **Step 2: Commit**

```bash
git add INSTRUCCIONES.md
git commit -m "docs: agregar paso manual pendiente para aceptar Educadores en el backend"
```

## Self-Review

**Spec coverage:** regla de clasificación completa (4 ramas → igual que hoy, vacío → descarta, "Padre representante..." → descarta, resto → Educadores) en Task 1 Step 2; excepciones por DNI siguen ganando primero (no se tocó ese orden); única categoría "Educadores" sin distinguir rama real (Task 1, ningún cambio de esquema); whitelist de ramas ampliada en frontend (`RAMAS_VALIDAS`, Task 1 Step 1) y backend (`RAMAS`, Task 2); vista previa muestra la categoría nueva (Task 1 Step 4); filtro de Deudores la incluye (Task 1 Step 5); fondo de Programa por rama sin cambios (no se tocó `calcularFondosPorRama`, confirmado por grep en Task 2 Step 2 de que el resto del backend no depende de una lista fija de 4 ramas); paso manual de deploy documentado (Task 3). Todo lo del spec está cubierto.

**Placeholders:** ninguno — todos los pasos tienen código completo y verificaciones con salida esperada concreta.

**Consistencia de tipos:** `esFuncionEducador(funcion)` se define en Task 1 Step 1 y se consume igual en Step 2 (dentro de `procesarFilasNomina`) y se verifica standalone en Step 3. El payload `[dni, apellido, nombre, rama]` que arma `procesarFilasNomina` (con `rama` ahora también pudiendo ser `'Educadores'`) es exactamente lo que espera `validarBeneficiarios_` en el backend (Task 2) — mismo formato que ya usaba el resto de las ramas, ningún campo nuevo. `porRama` con la clave `Educadores` se define en `procesarFilasNomina` (Task 1 Step 2) y se consume igual en `mostrarVistaPreviaNomina` (Task 1 Step 4); todas las listas/objetos de ramas (`RAMAS_VALIDAS`, la `RAMAS` local de la vista previa, y en el backend tanto `RAMAS` como el `porRama` inicial de `validarBeneficiarios_`) quedan con los mismos 5 valores.

**Corrección durante la auto-revisión:** la primera versión de este plan solo agregaba `'Educadores'` al array `RAMAS` del backend (Task 2) y no al objeto `porRama` inicial de la misma función (`backend/Code.gs:275`) — con eso, `porRama['Educadores']++` sobre una clave inexistente hubiera dado `NaN` en vez de `1` en la respuesta de `actualizarBeneficiarios`. Se corrigió antes de aprobar el plan; Task 2 Step 1 ahora actualiza las dos líneas juntas.
