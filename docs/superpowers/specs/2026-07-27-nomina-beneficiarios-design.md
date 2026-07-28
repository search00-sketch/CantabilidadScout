# Carga de Nómina para Beneficiarios — Diseño

Fecha: 2026-07-27

## Objetivo

Reemplazar la carga manual de la hoja `BENEFICIARIOS` (hoy editada a mano directamente en la planilla) por una carga desde un archivo Excel/CSV: la nómina oficial que se exporta del sistema de Scouts de Argentina (columnas Tipo de Documento, Dni, Nombre, Celular, Función, Categoria, Zona, Distrito, Código, Organismo, Fecha de Nacimiento, Religión).

## Alcance

- Nueva sección "Beneficiarios" en el menú de la app, donde se sube el archivo y se actualiza `BENEFICIARIOS`.
- Cada carga es un **reemplazo total**: quien figura en el archivo nuevo queda activo; quien no figura, deja de estar en `BENEFICIARIOS` (deja de contar para cuotas, Deudores y fondo por rama).
- No se guarda el archivo original ni las columnas que no se usan (Celular, Categoria, Zona, Distrito, Código, Organismo, Fecha de Nacimiento, Religión) — no hacen falta para el objetivo de este cambio.
- No hay historial de cargas anteriores, solo la fecha/hora de la última.
- No se restringe esta sección por rol de usuario (hoy ningún tab del menú está restringido por rol; se mantiene igual).
- El ID de beneficiario pasa a ser el DNI (confirmado: la columna A de `BENEFICIARIOS` ya es el DNI hoy, así que los pagos históricos en `INGRESOS_unitario` —que referencian ese ID en la columna G— siguen enlazando correctamente).

## Mapeo de columnas y filtro de ramas

De cada fila del archivo se usan solo:

| Columna del archivo | Uso |
|---|---|
| `Dni` | ID del beneficiario → columna A de `BENEFICIARIOS` |
| `Nombre` (formato "Apellido, Nombre") | Se separa por la primera coma → columnas B (apellido) y C (nombre) de `BENEFICIARIOS` |
| `Función` | Determina la rama (columna D de `BENEFICIARIOS`) — solo estos 4 valores exactos se aceptan, cualquier otro valor (educadores, representantes distritales/zonales, roles de dirigentes, etc.) se descarta: |

| Función | Rama |
|---|---|
| Lobato / Lobezna | Manada |
| Scout | Unidad |
| Caminante | Caminantes |
| Rover | Rovers |

- La columna `Activo` (E) de `BENEFICIARIOS` se completa siempre en `SI` para toda fila que pasa el filtro.
- Si un mismo DNI aparece más de una vez en el archivo (por ejemplo, una vez como "Caminante" y otra con una función especial como "Representante Juvenil de Grupo a la Asamblea Distrital"), la fila con función fuera de las 4 válidas ya queda excluida por el filtro de Función, así que no genera duplicados en el caso esperado. Si dos filas válidas compartieran el mismo DNI (caso no esperado), se conserva la última y se avisa en la vista previa.
- Filas sin DNI o sin Nombre se descartan y se cuentan como error en la vista previa.

## Frontend (`public/index.html`)

- SheetJS ya está cargado en `public/index.html:481` (`xlsx-0.20.2`, usado hoy por `descargarExcel()` para exportar informes) — no se agrega ninguna dependencia nueva. Se reutiliza `XLSX.read()` / `XLSX.utils.sheet_to_json()` para parsear el `.xlsx`/`.csv` subido, en el navegador.
- Nuevo ítem de menú **"Beneficiarios"**, junto a Dashboard/Ingresos/Egresos/Deudores/Informes.
- Nueva sección con:
  1. Input de archivo (`accept=".xlsx,.csv"`).
  2. Al elegir el archivo, se parsea al instante y se arma una **vista previa**, sin tocar la planilla todavía:
     - Cantidad de beneficiarios reconocidos por rama (Manada / Unidad / Caminantes / Rovers).
     - Cantidad de filas descartadas (función no reconocida).
     - Cantidad de filas con error (sin DNI/Nombre, DNI duplicado entre filas válidas).
  3. Botón **"Confirmar carga"**, deshabilitado si no hay ninguna fila válida. Antes de confirmar se muestra un aviso de que es un reemplazo total de los beneficiarios activos actuales.
  4. Al confirmar, se llama a la nueva acción de backend `actualizarBeneficiarios` con el array ya filtrado y mapeado: `{ beneficiarios: [[dni, apellido, nombre, rama], ...] }`.
  5. Al terminar, se refresca `beneficiariosData` (mismo dato que ya llena `bootstrap`) y se muestra cuántos quedaron activos en total y por rama, junto con la fecha/hora de la actualización (leída de `CONFIG.beneficiarios_actualizado_en`).

## Backend (Apps Script — fragmento para `backend/Code.gs` local y el real desplegado)

Nueva acción en `ejecutar_`:
```js
case 'actualizarBeneficiarios': return actualizarBeneficiarios_(p);
```

`actualizarBeneficiarios_(p)`:
- Valida que `p.beneficiarios` sea un array no vacío; cada fila requiere DNI numérico, apellido/nombre no vacíos, y rama dentro de `['Manada','Unidad','Caminantes','Rovers']` (validación mínima server-side, por si se bypasea el frontend).
- Bajo `LockService.getScriptLock()` (mismo patrón que `addIngreso_`):
  - Limpia el rango de datos de `BENEFICIARIOS` desde la fila 2 (mantiene encabezados).
  - Escribe las filas nuevas: `[dni, apellido, nombre, rama, 'SI']`.
  - Escribe/actualiza en `CONFIG` la fila `beneficiarios_actualizado_en` con `new Date().toISOString()`.
- Devuelve `{ ok: true, total: n, porRama: {...} }`.

Nota: igual que en el diseño de "fondo de programa por rama", el archivo local `backend/Code.gs` está truncado, así que el cambio se entrega como fragmento puntual para pegar a mano en el Apps Script real.

## Validaciones y manejo de errores

- Archivo sin las columnas esperadas (`Dni`, `Nombre`, `Función`) → error claro en la vista previa, no se habilita "Confirmar carga".
- Archivo vacío o sin ninguna fila con función válida → error, no se habilita "Confirmar carga".
- Errores de red/backend al confirmar → mensaje de error, `BENEFICIARIOS` no se toca (el reemplazo ocurre server-side en una sola operación).

## Pasos manuales (fuera de este repo)

1. Apps Script real → pegar `actualizarBeneficiarios_` y el nuevo case en `ejecutar_` → **Implementar → Administrar implementaciones → Nueva versión**.
2. Deploy de hosting (`firebase deploy --only hosting`) para publicar el `index.html` actualizado con la nueva sección y SheetJS.

## Fuera de alcance

- No se guarda el archivo original ni las columnas no usadas de la nómina (Celular, Categoria, Zona, Distrito, Código, Organismo, Fecha de Nacimiento, Religión).
- No hay historial de cargas anteriores, ni deshacer una carga ya confirmada.
- No se agrega control de acceso por rol para esta sección.
- No se modifica cómo se calculan cuotas, Deudores ni fondo por rama — siguen leyendo `BENEFICIARIOS` igual que hoy, solo cambia cómo se puebla esa hoja.
