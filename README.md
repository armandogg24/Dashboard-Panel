# 📊 Panel de Gestión de Suscriptores

Sistema 100% gratuito para administrar suscriptores manuales, recibir alertas de
Telegram 7/3/1 días antes de cada vencimiento y premiar referidos con % acumulable.

**Stack:** GitHub Pages · Firebase (Firestore + Auth, plan Spark) · Telegram Bot API · GitHub Actions

## 📁 Estructura pública
```
├── index.html                  Panel SPA (login + resumen + CRUD + referidos + config)
├── css/styles.css              Diseño premium responsive (280px→4K)
├── js/config.js                Config de Firebase + UID del admin
├── js/db.js                    Capa de datos Firestore
├── js/app.js                   UI, formularios, renovaciones
├── tools/notificar.mjs         Alertas diarias 7/3/1 (sin duplicados)
├── tools/verificar.mjs         Verificación de conexiones
└── .github/workflows/
    └── mantenimiento.yml       Cron diario + ejecución manual
```

> 🔒 La documentación de instalación, SOPs internos y memoria del proyecto se
> mantienen en privado fuera de este repositorio.
> Las reglas de seguridad de Firestore se gestionan directamente en la consola
> de Firebase (acceso restringido al UID del administrador).

## 🔐 Seguridad
- Claves sensibles SOLO en GitHub Secrets (`FIREBASE_SERVICE_ACCOUNT`,
  `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`) — jamás en el repo.
- `firebaseConfig` del front es público por diseño: el acceso real lo controlan
  Firebase Auth + las reglas de Firestore.
- El script de notificaciones usa el Admin SDK únicamente dentro de Actions.

## 💸 Costo
$0 dentro de los límites free tier (sobrado para cientos/miles de suscriptores).

## 🗺️ Roadmap futuro
Bot interactivo para usuarios finales (/start, consulta de saldo) · pasarela de pago ·
recordatorios configurables por usuario.
