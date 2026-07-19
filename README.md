# Sistema de Gestión Contable — Grupo Scout San José Obrero N°466

Web app de contabilidad con Google Sheets como base de datos y backend seguro en Apps Script.

## Estructura

```
contabilidad-scout-sjo/
├── public/index.html      → frontend (se deploya a Firebase Hosting)
├── backend/Code.gs        → copia del backend (ya desplegado en Apps Script)
├── firebase.json          → config de hosting (sitio: contabilidad-sjo466)
├── .firebaserc            → proyecto: menu-scout-sjo
└── INSTRUCCIONES.md       → guía completa de despliegue y pasos pendientes
```

## Deploy (desde esta carpeta)

```bash
npm install -g firebase-tools                                          # solo la primera vez
firebase login                                                         # con search0.0@gmail.com
firebase hosting:sites:create contabilidad-sjo466 --project menu-scout-sjo   # solo la primera vez
firebase deploy --only hosting
```

App: **https://contabilidad-sjo466.web.app**

## Componentes

- **Planilla** (base de datos, editable): [SISTEMA_CONTABLE_SCOUT_2026](https://docs.google.com/spreadsheets/d/1-1ADHfkdnuWmPy4Fnuxg9ULqm5xGb1pO-crgqWukFi0/edit)
  - Usuarios autorizados: pestaña USUARIOS (ACTIVO = SI/NO)
  - Parámetros de cuotas y campamentos: pestaña CONFIG
- **Backend**: Apps Script "Backend Contable Scout SJO" (Extensiones → Apps Script desde la planilla)
- **Hosting**: Firebase, proyecto menu-scout-sjo, sitio contabilidad-sjo466

⚠️ Antes del primer uso ver INSTRUCCIONES.md — quedan pasos pendientes (origen OAuth, eliminar API key vieja, privatizar planilla).
