# Incluir Educadores en la Carga de Nómina — Diseño

Fecha: 2026-07-29

## Objetivo

Hoy la carga de nómina (`docs/superpowers/specs/2026-07-27-nomina-beneficiarios-design.md`) solo reconoce como beneficiario a quien tiene Función = Lobato / Lobezna, Scout, Caminante o Rover; todo el resto (educadores, equipo de apoyo, padres representantes, etc.) se descarta. Los educadores/dirigentes también tienen que poder pagar campamento (no cuota/afiliación), así que necesitan quedar cargados como beneficiarios.

## Alcance

- Se agrega una quinta categoría de beneficiario: **Educadores**.
- Los educadores pueden anotarse y pagar Campamento Invierno/Verano, igual que hoy funciona para los chicos.
- Los educadores **no pagan cuota/afiliación** — esto ya sale gratis de la lógica existente (ver más abajo), no hace falta tocarla.
- Quedan **fuera** de este cambio los "Padre representante de [rama]" — no se los da de alta como beneficiarios.
- No se toca el cálculo de fondo de Programa por rama (esa función, cuando esté mergeada, sigue siendo exclusiva de las 4 ramas de chicos).

## Regla de clasificación (reemplaza el filtro actual en `procesarFilasNomina`)

Para cada fila de la nómina:

1. Si la Función es exactamente una de las 4 ramas (`Lobato / Lobezna`, `Scout`, `Caminante`, `Rover`) → rama = la rama correspondiente (Manada/Unidad/Caminantes/Rovers), igual que hoy.
2. Si la Función está vacía → la fila se descarta (igual que hoy).
3. Si no, y la Función **no** empieza con "Padre representante" (sin distinguir mayúsculas/minúsculas) → rama = **`Educadores`**.
4. Si la Función empieza con "Padre representante" → la fila se descarta (mismo comportamiento que hoy para lo no reconocido).

Las excepciones por DNI configuradas en `CONFIG.excepciones_rama_dni` (ver spec de nómina) se siguen evaluando **antes** que esta regla — si un DNI tiene una excepción, esa rama gana sin importar la Función.

## Por qué no hace falta tocar la lógica de cobro

- `pagaAfiliacion` (en `calcularEstadosBeneficiarios`, `public/index.html`) se calcula comparando la rama contra `CONFIG.ramas_afiliacion` (por defecto `Manada,Unidad,Caminantes,Rovers`). `Educadores` nunca va a estar en esa lista, así que automáticamente no le corresponde cuota — se muestra "No aplica", igual que hoy pasa para cualquier rama fuera de esa lista.
- El campamento (Invierno/Verano) ya se calcula sin mirar la rama: cualquier beneficiario con al menos un pago de campamento cargado queda "anotado" y se le calcula lo pendiente contra el monto de `CONFIG`. Un educador que paga campamento aparece en Deudores exactamente igual que un chico.

## Cambios concretos

- **`procesarFilasNomina` (frontend):** aplica la regla de clasificación de arriba en vez del descarte actual para todo lo que no sea una de las 4 ramas.
- **Listas de ramas válidas:** tanto `RAMAS_VALIDAS` (usada por `parsearExcepcionesRama` en el frontend) como `RAMAS` (usada por `validarBeneficiarios_` en el backend) pasan a tener 5 valores: las 4 ramas + `Educadores`.
- **Filtro de rama en Deudores** (`#filtro-rama`): se agrega la opción "Educadores".
- **Vista previa de la carga de nómina:** la tabla de conteos por rama pasa a tener una fila más, "Educadores".
- **Selector de beneficiario en Ingresos:** no requiere cambios — ya se puebla dinámicamente desde `beneficiariosData`, así que los educadores van a aparecer solos ahí una vez cargados.

## Fuera de alcance

- No se agrega ninguna distinción de a qué rama pertenece cada educador (todos comparten la categoría única "Educadores") — confirmado con el usuario, evita tener que separar "tipo de persona" de "rama" en el modelo de datos.
- No se incluye a los "Padre representante de [rama]".
- No se modifica el cálculo de fondo de Programa por rama (sigue siendo exclusivo de las 4 ramas de chicos).
- No se agrega ninguna cuota o monto nuevo específico para educadores — pagan campamento con los mismos montos de `CONFIG` que ya existen (`campamento_invierno`, `campamento_verano`).
