# Fondo de Programa por Rama — Diseño

Fecha: 2026-07-19

## Objetivo

Poder discriminar el gasto de rubro "Programa" por rama (Manada, Unidad, Caminantes, Rovers), y mostrar en el dashboard cuánto fondo le queda a cada rama, a partir de un monto asignado de $10.000 por beneficiario activo de esa rama.

## Alcance

- Solo los egresos con Rubro = "Programa" se descuentan del fondo de una rama. El resto de los rubros de egreso (Mantenimiento, Limpieza, Campamento, etc.) no tiene rama y no afecta este cálculo.
- El fondo es acumulado histórico (no se resetea por período), igual que el resto de los saldos del sistema.
- Aplica a las 4 ramas existentes en la app: Manada, Unidad, Caminantes, Rovers.

## Modelo de datos

**Hoja `EGRESOS`**: nueva columna al final, **I: Rama**. Vacía salvo cuando Rubro="Programa", donde es obligatoria.

**Hoja `CONFIG`**: nueva fila `monto_programa_por_beneficiario = 10000` (tasa única aplicada a las 4 ramas por igual).

**Fórmula**, por rama:
```
fondo_asignado = monto_programa_por_beneficiario × cantidad_beneficiarios_activos(rama)
gastado        = suma de EGRESOS donde Rubro="Programa" y Rama=rama
restante       = fondo_asignado − gastado
```

## Backend (Apps Script — `backend/Code.gs` local, y el real desplegado)

- `addEgreso_(p, user)`: acepta `p.rama`. Si `p.rubro === 'Programa'` y no hay rama, error. Se agrega `rama` como 9° elemento del `appendRow` (columna I).
- `getMovimientos_()`: en el loop de egresos, se agrega `String(r[8] || '')` como 7° elemento del array (rama), tomado de la columna I de la hoja.

Nota: el archivo local `backend/Code.gs` está truncado (corta a mitad de `toISO_`, sin la función `num_`). Los cambios de backend se entregan como fragmentos puntuales para pegar a mano en el Apps Script real, no como reemplazo completo del archivo.

## Frontend (`public/index.html`)

- **Form de Egreso**: al elegir Rubro="Programa" aparece un select "Rama" (obligatorio), oculto para el resto de los rubros — mismo patrón que ya usa Ingresos con Beneficiario/Cuota.
- **Dashboard**: la card "PENDIENTE DE COBRO" (con sus IDs `total-pendiente` y `familias-al-dia`) se reemplaza por una card "FONDO DE PROGRAMA POR RAMA" que lista las 4 ramas con su fondo restante (rojo si quedó negativo).
- Nueva función `calcularFondosPorRama()`: calcula asignado/gastado/restante por rama a partir de `beneficiariosData`, `movimientos.egresos` y `configData`.
- Nueva función `cargarFondosPorRama()`: renderiza el resultado en `#fondos-rama`. Se llama al final de `cargarSaldos()`.
- El dato agregado de "pendiente de cobro" deja de mostrarse en el dashboard. Sigue disponible por beneficiario en la sección Deudores (no se pierde, solo no hay más un total en el dashboard).

## Pasos manuales (fuera de este repo)

1. Planilla → hoja `EGRESOS` → agregar encabezado "Rama" en `I1`.
2. Planilla → hoja `CONFIG` → agregar fila `monto_programa_por_beneficiario | 10000`.
3. Apps Script real → pegar los cambios de `addEgreso_` y `getMovimientos_` → **Implementar → Administrar implementaciones → Nueva versión** (si no se redespliega, el Web App sigue sirviendo el código viejo).
4. Deploy de hosting (`firebase deploy --only hosting`) para publicar el `index.html` actualizado.

## Fuera de alcance

- No se toca el cálculo de "pendiente de cobro" por beneficiario en la sección Deudores.
- No se agregan tasas configurables por rama individual (se usa una sola tasa global, según lo confirmado).
- No se filtra el fondo por período (es acumulado, como el resto del sistema).
