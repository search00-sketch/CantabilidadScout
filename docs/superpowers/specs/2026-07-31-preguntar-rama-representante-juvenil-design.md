# Preguntar Rama para "Representante Juvenil" — Diseño

Fecha: 2026-07-31

## Objetivo

Cuando la nómina trae una fila cuya `Función` contiene "Representante Juvenil" (sin distinguir mayúsculas/minúsculas) y esa persona no tiene ya una excepción configurada en `CONFIG.excepciones_rama_dni`, la carga la clasifica hoy como "Educadores" — incorrecto, ya que se trata de jóvenes/protagonistas, no de adultos. En vez de eso, la vista previa de la carga debe pedirle al admin que elija la rama real de esa persona, y guardar esa elección automáticamente como excepción para que las próximas cargas ya la reconozcan sin volver a preguntar.

## Alcance

- Aplica únicamente a filas cuya `Función` no resuelve rama por excepción (`CONFIG.excepciones_rama_dni`) ni por match exacto con las 4 ramas, y cuyo texto contiene "representante juvenil" (case-insensitive, substring — no debe ser un match exacto ni un prefijo anclado, ya que puede haber variantes futuras del título).
- Si esa misma persona (mismo DNI) tiene, en el mismo archivo, otra fila que sí resuelve una rama (por excepción o por Función exacta), esa rama gana y la persona no aparece como pendiente — mismo criterio que ya usa el desempate de DNI duplicado existente.
- Toda persona pendiente debe recibir una rama para poder confirmar la carga — no existe una opción de "saltear"/excluir a un pendiente.
- Al confirmar la carga, la asignación elegida se persiste en `CONFIG.excepciones_rama_dni` en el mismo formato ya existente (`dni:rama;dni:rama`), agregada a lo que ya hubiera. Si por algún motivo el DNI ya tuviera una excepción previa (no debería pasar en operación normal, ya que un DNI con excepción existente nunca llega a ser "pendiente"), se actualiza en vez de duplicarse.
- No se valida la elección de rama contra la fecha de nacimiento ni ningún otro dato de la persona — se confía en el criterio del admin.
- No se modifica el mecanismo de excepción manual existente (seguir editando `CONFIG` a mano sigue siendo posible).

## Frontend (`public/index.html`)

### `procesarFilasNomina` — nuevo campo de salida `pendientesRama`

La función pura sigue recibiendo `(filas, excepcionesRama)` sin cambios en la firma. Al resolver la rama de cada fila:

1. Si `excepcionesRama[dni]` resuelve, se usa esa rama (sin cambios respecto a hoy).
2. Si no, y `FUNCION_A_RAMA[funcion]` resuelve (una de las 4 ramas exactas), se usa esa (sin cambios).
3. Si no, y la Función (case-insensitive) contiene `"representante juvenil"`, la fila no se agrega a `validas` ni se cuenta en `descartadas`: el DNI/apellido/nombre (si son válidos — mismo chequeo de DNI numérico y separación por la primera coma que ya existe) se agregan a un mapa interno de "candidatos a pendiente", indexado por DNI.
4. Si no, se aplica la lógica actual: `esFuncionEducador(funcion) ? 'Educadores' : ''` (Función vacía o "Padre representante..." → descartada; cualquier otra → Educadores).

Después de procesar todas las filas, se recorren los candidatos a pendiente y se descartan los DNI que terminaron con una entrada resuelta en `validas` (por otra fila del mismo DNI). Lo que queda es `pendientesRama`: un array de `{ dni, apellido, nombre }`.

El resultado de `procesarFilasNomina` pasa a ser `{ validas, porRama, descartadas, errores, duplicados, pendientesRama }`.

### Vista previa: selector de rama por pendiente

En la sección de vista previa de la carga, debajo de la tabla de conteo por rama, si `pendientesRama.length > 0` se muestra una lista: por cada persona, su nombre (`apellido, nombre`) y DNI, junto a un `<select>` con las 4 ramas (opción vacía/placeholder por defecto, sin opción "Educadores" — estas personas son confirmadas como jóvenes, no adultos).

El botón "Confirmar carga" ya se deshabilita hoy cuando no hay ninguna fila válida (`filasNominaValidas.length === 0`); a esa condición se le suma esta nueva: también permanece deshabilitado mientras exista algún `<select>` de pendiente sin una rama elegida. Se habilita solo cuando ambas condiciones están resueltas (hay al menos una fila válida y todos los pendientes tienen rama asignada).

### Confirmar carga

`confirmarCargaNomina()` arma, además del array `beneficiarios` que ya arma hoy (con las ramas elegidas para los pendientes ya incorporadas como filas normales `[dni, apellido, nombre, rama]`), un array `nuevasExcepciones: [{ dni, rama }, ...]` con lo que el admin eligió para cada pendiente. Ambos se envían en el mismo payload a la acción `actualizarBeneficiarios`.

## Backend (Apps Script — `backend/Code.gs`)

`actualizarBeneficiarios_(p, user)` acepta un campo opcional `p.nuevasExcepciones` (array de `{dni, rama}`, rama restringida a las 4 ramas de chicos). Bajo el mismo `LockService` que ya usa para reemplazar `BENEFICIARIOS` y actualizar `CONFIG.beneficiarios_actualizado_en`/`_por`:

- Si `p.nuevasExcepciones` no está vacío, lee el valor actual de `CONFIG.excepciones_rama_dni`, lo parsea al mismo formato `dni:rama;dni:rama`, agrega/actualiza las entradas nuevas, y vuelve a escribir el valor combinado en esa misma fila de `CONFIG` (o la crea si no existía, mismo patrón que ya usa para `beneficiarios_actualizado_en`).
- Se valida cada `rama` de `nuevasExcepciones` contra las 4 ramas de chicos (no contra "Educadores" — no tendría sentido guardar una excepción hacia esa categoría, ya que esa es la clasificación por defecto).

## Fuera de alcance

- No hay opción de excluir/saltear a un pendiente sin asignarle rama.
- No se valida la elección contra fecha de nacimiento u otro dato.
- No se modifica el mecanismo de excepción manual existente en `CONFIG`.
- No se agrega historial de qué excepciones se agregaron cuándo ni por quién (la excepción queda igual que las agregadas a mano, sin metadata adicional).
