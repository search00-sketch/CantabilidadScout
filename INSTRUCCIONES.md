# Migración de seguridad — Sistema Contable Scout SJO N°466

## ✅ Ya hecho (automatizado en esta sesión)

- Backend **"Backend Contable Scout SJO"** creado como Apps Script vinculado a la planilla, con el código completo.
- Script Properties configuradas (CLIENT_ID + las 3 carpetas de Drive).
- Web App implementada: *Ejecutar como Yo / Acceso: Cualquier usuario* — autorizada por vos.
- API verificada y funcionando: responde `{"ok":true,"data":"API Scout activa"}`.
- Pestaña **USUARIOS** existente detectada y el backend adaptado a sus columnas (A=Email, B=Rol, D=Activo). Para dar de baja a alguien: ACTIVO = NO.
- **index.html** final generado con la URL del backend ya incluida.

URL del backend:
`https://script.google.com/macros/s/AKfycbwF8dBiSAatoJ1YH8repnHDoDLqx0laYUe7YT4C6FVuzG8WB7zPLn1uL2GZ7JCD0ymWGA/exec`

⚠️ Esta URL cambia si alguna vez se crea una **implementación nueva** en vez de editar la existente y subir una "Nueva versión" desde Administrar implementaciones. Si el frontend deja de recibir cambios del backend, lo primero a revisar es si esta URL sigue siendo la vigente.

## Pasos que quedan (en este orden)

### 1. Autorizar el dominio en el cliente OAuth (2 min)

1. Entrá a [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) (el proyecto donde está tu cliente OAuth).
2. Abrí el **ID de cliente de OAuth 2.0** (el que empieza con `616578436911-...`).
3. En **Orígenes de JavaScript autorizados**, agregá:
   - `https://contabilidad-sjo466.web.app`
4. Guardá. Puede tardar 5-10 minutos en aplicarse.

### 2. Crear el sitio nuevo y deployar (proyecto menu-scout-sjo, cuenta search0.0)

Desde la carpeta **deploy-firebase** entregada (ya tiene todo configurado):

```bash
npm install -g firebase-tools        # solo si no lo tenés
firebase login                       # con search0.0@gmail.com
firebase hosting:sites:create contabilidad-sjo466 --project menu-scout-sjo
firebase deploy --only hosting
```

La app queda en **https://contabilidad-sjo466.web.app** (URL nueva para pasar a los dirigentes).

> El sitio viejo `contabilidad-scout.web.app` (cuenta "backup...") va a dejar de funcionar solo cuando elimines la API key en el paso 4 — no hace falta tocarlo. Si más adelante recuperás esa cuenta, podés borrar el proyecto directamente.

### 3. Probar

1. Abrí https://contabilidad-sjo466.web.app → botón de Google → con tu cuenta → debe cargar el dashboard con los saldos.
2. Probá con una cuenta que NO esté en USUARIOS → debe decir "no está autorizada".
3. Cargá un ingreso de prueba → verificá la fila en INGRESOS_unitario, el comprobante en Drive y la fila en COMPROBANTES.

### 4. Recién cuando el paso 3 funcione — cerrar la puerta vieja

**a) Eliminar la API key expuesta** (quedó publicada en el HTML viejo):
Cloud Console → Credenciales → API key `AIzaSyDktl...qC7o` → Eliminar.
El sistema nuevo no usa ninguna key.

**b) Poner la planilla en privado:**
En la planilla → Compartir → cambiar "Cualquier persona con el enlace" a **Restringido**.
Los usuarios de la app NO necesitan acceso a la planilla — solo vos como dueño.

⚠️ No hagas 4a/4b antes de que el paso 3 funcione: la versión vieja de la app depende de la key y del acceso público, y quedaría caída sin reemplazo.

## Qué cambió (resumen técnico)

- Sin API key ni ID de planilla en el HTML: todo pasa por el Web App con validación de token de Google en el servidor contra la pestaña USUARIOS (imposible de saltear desde el navegador).
- Login con Google Identity Services (reemplaza el flujo implícito deprecado). La columna de contraseñas de USUARIOS ya no se usa — podés borrarla cuando quieras.
- Número de comprobante atómico con LockService (sin duplicados por carga simultánea).
- Orden de guardado seguro: primero el ingreso, después el comprobante.
- Fechas y montos normalizados en el servidor (corrige errores de parseo con comas y formatos de fecha).
- Bug corregido: campamento con valor 0 ya no genera deuda fantasma de $60.000.
- El link del adjunto de ingresos ahora queda registrado en la columna F.
- Nombres y detalles se escapan antes de renderizar (previene inyección HTML).

## Pendientes para una próxima etapa

- Períodos de informes hardcodeados (Mar 2026–Mar 2027 / Jul 2025–Jun 2026): moverlos a CONFIG.
- El popup del comprobante puede ser bloqueado por el navegador.
- Renovación silenciosa del token para sesiones de más de 1 hora.
- Borrar la columna Contraseña de USUARIOS (ya no cumple función).

## Pendiente: Fondo de Programa por Rama

Cambios de código ya hechos en este repo (backend/Code.gs y public/index.html). Faltan estos 3 pasos manuales para que tengan efecto:

1. En la planilla → hoja EGRESOS → agregar el encabezado "Rama" en la celda I1.
2. En la planilla → hoja CONFIG → agregar la fila: `monto_programa_por_beneficiario` | `10000`.
3. En el editor de Apps Script (Extensiones → Apps Script desde la planilla) → reemplazar `addEgreso_` y el loop de egresos de `getMovimientos_` con el contenido de `backend/Code.gs` → Implementar → Administrar implementaciones → editar la implementación existente → Nueva versión → Implementar.

**Limitación importante:** Los egresos con Rubro="Programa" registrados *antes* de agregar la columna Rama tendrán esa celda vacía para siempre y no se acumularán en el fondo de ninguna rama. Por lo tanto, el saldo "restante" de cada rama será preciso únicamente para gastos de Programa posteriores al rollout — a menos que se rellene manualmente la columna Rama en esas filas históricas.

Después de estos 3 pasos, hacer `firebase deploy --only hosting` para publicar el `index.html` actualizado.
