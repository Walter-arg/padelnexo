# AUDITORÍA PRE-PUBLICACIÓN PADELNEXO

**Fecha de la auditoría:** 12 de agosto de 2026
**Alcance:** repo `padel-amateur-app` (React Native / Expo SDK 54, RN 0.81.5, Firebase, Mercado Pago). Auditoría de solo lectura, basada exclusivamente en el código real del proyecto.

## RESUMEN EJECUTIVO

**Estado general: 🟠 REQUIERE CORRECCIONES**

La app está técnicamente avanzada y con buena parte de la seguridad bien resuelta (reglas de Firestore razonablemente estrictas, subcolección `private/contact` para datos sensibles, funciones admin protegidas server-side con verificación de ID token, Crashlytics con manejo global de errores y de promesas sin catch, checkbox real de Términos/Privacidad, flujo de eliminación de cuenta con reautenticación). Pero hay **3 hallazgos críticos** que conviene resolver antes de operar con usuarios y dinero reales, y varios hallazgos importantes que conviene resolver antes de la publicación definitiva.

**Conteo de hallazgos de esta auditoría:**
- 🔴 CRÍTICO: 3
- 🟠 IMPORTANTE: 7
- 🟡 RECOMENDADO: 8
- 🟢 CORRECTO: 18+

**Riesgos principales:**
1. **Manipulación de monto en pagos de Mercado Pago** (turnos, torneos, ligas): el precio que se cobra lo define el cliente en la llamada a la Cloud Function (`payload.amount`), sin validación server-side contra el precio real guardado en Firestore. Riesgo de fraude económico directo.
2. **Datos de jugadores falsos (`playersMock`) se muestran a usuarios reales** como fallback cuando no hay jugadores reales cargados o falla la consulta a Firestore (Jugadores, Favoritos, Detalle de jugador). Es contenido engañoso en producción.
3. **No hay `storage.rules` versionado en el repo** ni declarado en `firebase.json` — el estado real de las reglas de Firebase Storage no es verificable desde el código y debe confirmarse manualmente en la consola de Firebase.
4. Push notifications (expo-notifications) está instalado y configurado como plugin, pero el registro real de push token es un *no-op* explícito en el código — no hay notificaciones push funcionando hoy.
5. La eliminación de cuenta es parcial: borra el perfil, pero deja huérfanos mensajes, inscripciones, invitaciones, reportes y reservas con el UID del usuario eliminado; además el email no queda bloqueado cuando el usuario se autoelimina (sí cuando lo elimina un admin), por lo que puede volver a registrarse de inmediato.

---

## 1-2. OBJETIVO Y METODOLOGÍA

Se inspeccionaron: `package.json`, `app.json`, `eas.json`, `firebase.json`, `.firebaserc`, `firestore.rules`, `babel.config.js`, `metro.config.cjs`, `.env` / `.env.example` (raíz y `functions/`), `google-services.json`, `App.js`, todo `src/` (components, screens, services, context, config, utils, data, navigation), `services/` (wrappers de Firebase), y `functions/` (Cloud Functions: `index.js`, `adminActions.js`, `adminShared.js`, `mercadoPagoCheckoutPro.js`, `mercadoPagoOAuth.js`, `mercadoPagoShared.js`, `checkPlanExpirations.js`, `sendPasswordReset.js`, `sendWelcomeEmail.js`, `sendPlanActivationEmail.js`, `sendPlanExpirationWarning.js`).

No se instalaron paquetes, no se ejecutaron builds, no se modificó ningún archivo del proyecto salvo este informe, y no se usó git.

---

## 3. APPLICATION ID / PACKAGE / NOMBRE

- Nombre visible: `PadelNexo` (`app.json` → `expo.name`).
- Slug Expo: `padelnexo`.
- Android package: `com.padelnexo.app` (`app.json` → `android.package`).
- iOS bundle id: `com.padelnexo.app` (consistente con Android).
- `scheme`: `com.padelnexo.app` (usado también para el deep link de retorno de Mercado Pago Checkout Pro).
- Coincide con `google-services.json` (`android_client_info.package_name: "com.padelnexo.app"`) y con el proyecto Firebase `padelnexo-7e4d5`.

🟢 CORRECTO — Application ID consistente en todos los archivos de configuración.

---

## 4. SDK ANDROID / COMPATIBILIDAD EXPO

- `app.json` → plugin `expo-build-properties`: `targetSdkVersion: 36`, `compileSdkVersion: 36` (Android 16).
- Expo `~54.0.36`, React Native `0.81.5`, React `19.1.0` — línea consistente entre sí (SDK 54 de Expo usa RN 0.81 y React 19).
- Estas versiones son las vigentes al momento de la auditoría (agosto 2026) y no se detectaron incompatibilidades explícitas.

🟢 CORRECTO — targetSdk/compileSdk 36 está alineado a lo que Google Play exige para apps nuevas en esta fecha.
🟡 RECOMENDADO — Confirmar en Play Console, al momento de subir el primer build, que no haya un requisito de targetSdk más nuevo publicado después de esta fecha (Google actualiza este requisito una vez al año). NO VERIFICABLE DESDE EL PROYECTO.

---

## 5. VERSIONADO

- `app.json` → `expo.version: "1.0.0"`, igual a `package.json` (`"version": "1.0.0"`).
- `runtimeVersion.policy: "appVersion"` — la runtime version de EAS Update queda atada al `version` de arriba (correcto para el modelo de canales `development`/`preview`/`production`).
- `eas.json` → `cli.appVersionSource: "remote"`: el `android.versionCode` **no está en `app.json`** porque EAS lo administra remotamente (incrementa automáticamente en cada build). Esto es válido y es el patrón recomendado por Expo, pero significa que el próximo `versionCode` real **no es verificable desde el repo** — hay que consultarlo en el dashboard de EAS.
- Dado que ya hubo un build de producción (.aab) el 10/8/2026 y uno de development el 11/8/2026, el próximo build de producción incrementará el `versionCode` automáticamente; no hay riesgo de colisión mientras se use el mismo perfil `production` de `eas.json`.

🟢 CORRECTO — esquema de versionado remoto correctamente configurado.
🟡 RECOMENDADO — antes de la primera publicación, subir la versión `"1.0.0"` en `app.json`/`package.json` sólo si se quiere que la ficha de Play muestre otro número; hoy es coherente y no bloquea nada.
NO VERIFICABLE DESDE EL PROYECTO — valor exacto del próximo `versionCode` (vive en EAS, no en el repo).

---

## 6. EAS BUILD

`eas.json`:
```
development → developmentClient:true, distribution: internal, channel: development, android.buildType: apk
preview      → distribution: internal, channel: preview, android.buildType: apk
production   → channel: production, android.buildType: app-bundle
```

- El perfil de producción (`production`) genera **app-bundle (.aab)**, que es lo que Google Play exige. No define `distribution`, lo cual por defecto en EAS es `store` (correcto para subir a Play).
- `cli.version: ">= 16.0.0"` y `cli.appVersionSource: "remote"` — consistente con el punto anterior.
- Comando exacto para generar el AAB de producción (**no se ejecutó**, solo se documenta):
  ```
  eas build --platform android --profile production
  ```
- `.easignore` existe (contenido mínimo, 8 bytes) — revisar que no esté excluyendo accidentalmente algo necesario para el build; su tamaño sugiere que solo ignora una entrada puntual. NO VERIFICABLE DESDE EL PROYECTO sin ver el build log real de EAS.

🟢 CORRECTO — perfil de producción bien definido, genera AAB, canal `production` separado de `development`/`preview`.
NO VERIFICABLE DESDE EL PROYECTO — configuración de credenciales Android en el dashboard de EAS (keystore, Play App Signing), estado real de los builds ya generados, logs de build.

---

## 7. FIRMA DE ANDROID

El repo no contiene ningún keystore ni credenciales de firma (correcto: no deben vivir en el repo). La gestión de credenciales de Android para EAS Build vive en el servidor de Expo/EAS (`eas credentials`), no en archivos locales.

NO VERIFICABLE DESDE EL PROYECTO — REQUIERE COMPROBACIÓN MANUAL en el dashboard de EAS: si ya se generó/subió un keystore, si Play App Signing está habilitado para `com.padelnexo.app`, y si el certificado usado en el build de producción del 10/8/2026 es el que se seguirá usando (crítico: cambiar de keystore después de la primera publicación real en Play Store rompe las actualizaciones).

---

## 8. FIREBASE AUTHENTICATION

Implementado en `src/services/authService.js`, `services/firebaseAuth.js` y `src/context/AuthContext.js`:

- **Email/password**: `registerUser`/`loginUser` con `createUserWithEmailAndPassword`/`signInWithEmailAndPassword`. Contraseña mínima de 4 caracteres en el front (`RegisterScreen.js`, `MIN_PASSWORD_LENGTH = 4`) — bastante baja.
- **Google Sign-In**: `@react-native-google-signin/google-signin` + `loginWithGoogleIdToken` (credential de Firebase a partir del idToken de Google). Configurado en `app.json` con `iosUrlScheme` y client IDs consistentes con `google-services.json`.
- **Teléfono**: no está implementado como método de login (el teléfono en el perfil es solo un dato de contacto, no un proveedor de Firebase Auth).
- **Recuperación de contraseña**: no usa `sendPasswordResetEmail` del SDK de Firebase directo; llama a una Cloud Function propia (`sendPasswordReset`, vía Resend) — `RESET_PASSWORD_FUNCTION_URL` apunta a `southamerica-east1-padelnexo-7e4d5.cloudfunctions.net/sendPasswordReset`. Maneja el caso `email_service_not_configured`.
- **Logout**: `signOut(auth)` con manejo de errores.
- **Persistencia de sesión**: `initializeAuth` con `getReactNativePersistence(AsyncStorage)` — persistencia local correcta en RN (evita el warning típico de Firebase JS SDK en RN).
- **Cuentas bloqueadas/eliminadas**: `assertProfileCanAccess` en `AuthContext.js` cierra sesión automáticamente si `blockStatus` es `temporary`/`indefinite` o si `accountDeleted` es true, mostrando mensajes distintos. Bien resuelto tanto en login por email como por Google.
- **Verificación de email**: `sendEmailVerification` al registrarse, `resendVerificationEmail`, y se exige verificación antes de poder pedir el rol de organizador (`ProfileModal.js`).

🟢 CORRECTO — métodos de auth implementados con manejo de errores centralizado (`firebaseErrors.js`), persistencia de sesión adecuada, y bloqueo de cuentas bien resuelto en el cliente.
🟡 RECOMENDADO — contraseña mínima de 4 caracteres es muy débil para una cuenta con datos de pago asociados; subir a un mínimo razonable (8+) antes de escalar el volumen de usuarios.

---

## 9-11. FIRESTORE, REGLAS Y STORAGE

### 9. Colecciones reales usadas (verificadas en `firestore.rules` y en los servicios de `src/services`)

`users/{uid}` (+ subcolección `private/{contact}`), `leagues`, `tournaments/{id}` (+ subcolecciones `registrations`, `groups`, `matches`, `notifications`), `turnoReservations`, `turnosConfigs`, `leagueRegistrationRequests`, `conversations/{id}` (+ subcolección `messages`), `invitations`, `leagueFavorites`, `complexRequests`, `organizerRequests`, `reports`, `userBlocks`, `appConfig`, `blockedEmails`, `locations`, `adminAuditLog`.

No se encontraron colecciones inventadas ni mencionadas en el código que no estén reflejadas en las reglas.

### 10. Firestore Security Rules (`firestore.rules`)

No hay ningún `allow read, write: if true` genérico ni modo test. Puntos relevantes:

- `users/{userId}`: lectura abierta a cualquier autenticado (necesario para el listado de jugadores/organizadores), pero la escritura usa `isSafeUserSelfUpdate()` que **bloquea explícitamente** que el propio usuario modifique `role`, `organizerStatus` (salvo la única transición permitida: pedir organizador), `adminStatus`, `plan`, `planStatus`, `blockStatus` o `email` — todos esos campos sensibles solo se tocan desde las Cloud Functions con Admin SDK. Esto es un diseño correcto y deliberado.
- `users/{userId}/private/{document}`: solo el dueño puede leer/escribir — ahí vive el email y el teléfono real. Confirmado en `userService.js` (`createUserProfile`/`updateUserProfile`/`getUserProfile`).
- `blockedEmails/{email}`: `get` permitido a autenticados (para el chequeo al registrarse), `list` y `write` explícitamente denegados desde el cliente — solo la Cloud Function `deleteUserAccount` escribe ahí.
- `adminAuditLog`: solo lectura para admins, escritura denegada desde el cliente — coincide con `adminShared.js` (`logAdminAction`, vía Admin SDK).
- `conversations`/`messages`: lectura/escritura restringida a participantes, y condicionada además a `chatHabilitado` (≥14 años) o rol organizador — ver sección Mensajería más abajo.
- `turnoReservations`: lectura abierta a cualquier autenticado (justificado en un comentario: la app necesita ver todas las reservas próximas para calcular horarios libres), escritura restringida al dueño de la reserva (jugador u organizador).
- `esAdmin()` usa tanto un email hardcodeado (`wramirez.arg@gmail.com`) como `role == "admin"` / `adminStatus == "active"` leídos del propio documento del usuario — es razonable como *bootstrap* del primer admin, pero implica que ese email queda con privilegios de administrador de forma permanente y no removible desde la app.

🟢 CORRECTO — reglas bien diseñadas, sin exposición abierta, con separación clara entre datos públicos y privados y con los campos sensibles protegidos contra escritura del propio cliente.
🟡 RECOMENDADO — el email de admin hardcodeado en las reglas (`wramirez.arg@gmail.com`) y en `functions/adminShared.js` / `src/config/admin.js` es funcional pero rígido; documentarlo como "cuenta raíz" es suficiente por ahora.

### 11. Firebase Storage

- Uso real detectado: `profileImages/{uid}` (foto de perfil) y `organizerLogos/{uid}` (logo de organizador), ambos en `src/services/userService.js` vía `uploadBytes`/`getDownloadURL`/`deleteObject`.
- Los textos de permisos en `app.json` (`NSCameraUsageDescription`, etc.) mencionan también "comprobantes de pago", y en pantallas de pagos (`LeaguePaymentsScreen.js`, `TournamentPaymentsScreen.js`, `TournamentDetailScreen.js`, `CreateTournamentScreen.js`) se usa `ImagePicker` para adjuntar comprobantes — conviene confirmar en esos flujos a qué ruta de Storage suben esos comprobantes (no se identificó una ruta distinta a `profileImages`/`organizerLogos` en el código revisado; si en algún flujo se sube a Storage, revisar que la ruta incluya el UID del que sube para evitar colisiones/sobrescritura cruzada).
- **No existe `storage.rules` en el repo**, y `firebase.json` no declara ninguna sección `"storage"` (solo declara `functions`, `firestore.rules` y `hosting`). Esto significa que las reglas de Storage **no están versionadas junto al código** y no se despliegan desde este repo con `firebase deploy`.

🔴 CRÍTICO — Storage Rules no versionadas en el repo. No es posible confirmar desde el código si el bucket `padelnexo-7e4d5.firebasestorage.app` tiene reglas restrictivas (por ejemplo, "solo el dueño puede escribir su propia carpeta") o si quedó con una regla por defecto/abierta desde la creación del proyecto. **REQUIERE COMPROBACIÓN MANUAL en Firebase Console → Storage → Rules antes de publicar**, ya que ahí se guardan fotos de perfil, logos y (aparentemente) comprobantes de pago — datos sensibles.

---

## 12. VARIABLES DE ENTORNO Y SECRETOS

- `.gitignore` (raíz) excluye `.env` correctamente; `functions/.gitignore` excluye `functions/.env`. Ambos archivos `.env` reales existen en el filesystem local pero no están versionados.
- `.env` (raíz) solo contiene `EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` — es la *Public Key* de Mercado Pago, diseñada para ser pública/embebida en el cliente (no es un secreto). El prefijo `EXPO_PUBLIC_` la embebe en el bundle intencionalmente.
- `.env.example` (raíz) documenta correctamente que la config de Firebase está hardcodeada en `services/firebaseConfig.js` (apiKey, authDomain, etc.) porque es la config pública de cliente, no secreta — esto es correcto y coincide con la documentación oficial de Firebase (la `apiKey` de un cliente Firebase **no** funciona como secreto de seguridad; la seguridad depende de las Security Rules).
- `functions/.env` (no versionado) contiene credenciales reales de producción de Mercado Pago (Access Token con prefijo `APP_USR-`, no `TEST-`; Client Secret OAuth; Webhook Secret) y las flags `MERCADO_PAGO_USE_LINKED_ACCOUNTS=true` / `MERCADO_PAGO_REQUIRE_LINKED_ACCOUNTS=true` / `MERCADO_PAGO_OAUTH_TEST_TOKEN=false`. Detectado en: `functions/.env` (valor no reproducido en este informe). Está correctamente excluido de git.
- No se encontraron API keys ni tokens hardcodeados en código fuente de `src/` más allá de la `apiKey` pública de Firebase (comportamiento esperado) y client IDs de Google Sign-In (también públicos por diseño de OAuth en apps móviles).

🟢 CORRECTO — separación adecuada entre config pública (hardcodeada a propósito) y secretos reales (en `.env` no versionados). `.gitignore` cubre ambos `.env`.
🟡 RECOMENDADO — confirmar que las variables de `functions/.env` estén efectivamente cargadas en el entorno de Cloud Functions desplegado (Firebase Functions v2 lee `functions/.env` automáticamente en el deploy, pero esto no es verificable sin acceso a la consola de Firebase/GCP). NO VERIFICABLE DESDE EL PROYECTO.

---

## 13. MERCADO PAGO

- **Modo**: credenciales de **producción** reales en `functions/.env` (Access Token `APP_USR-...`, no `TEST-...`; `MERCADO_PAGO_OAUTH_TEST_TOKEN=false`). La Public Key del cliente (`.env` raíz) también tiene prefijo `APP_USR-`. No se detectaron tokens de test hardcodeados en el flujo de producción.
- **Modelo de cobro**: marketplace vía OAuth — cada organizador vincula su propia cuenta de Mercado Pago (`mercadoPagoOAuthService.js`, `MERCADO_PAGO_USE_LINKED_ACCOUNTS=true`, `MERCADO_PAGO_REQUIRE_LINKED_ACCOUNTS=true`). Esto significa que el dinero de turnos/torneos/ligas va a la cuenta del organizador/complejo, no a una cuenta central de PadelNexo — relevante para el análisis de Google Play Billing más abajo.
- **Backend/Cloud Functions**: `mercadoPagoCreateTurnoPreference`, `mercadoPagoCreateTournamentPreference`, `mercadoPagoCreateLeaguePreference` (creación de preferencia de Checkout Pro), `mercadoPagoSync*Payment` (sincronización manual desde el cliente al volver del checkout) y `mercadoPagoWebhook` (notificación server-to-server).
- **Validación de pagos**: el webhook **no confía en el body de la notificación** para el estado del pago: usa el `paymentId` recibido para pedir el pago real a la API de Mercado Pago (`GET /v1/payments/{paymentId}`) y recién ahí actualiza Firestore. Esto es el patrón correcto y mitiga notificaciones falsificadas en cuanto al *estado* del pago.
- **Firma del webhook**: `validateWebhookSignature()` (HMAC-SHA256 sobre `id`+`request-id`+`ts`, comparación con `crypto.timingSafeEqual`) está implementada correctamente y el secreto (`MERCADO_PAGO_WEBHOOK_SECRET`) **sí está configurado** en `functions/.env` — no es un placeholder vacío. Si no estuviera seteado, el código solo loguea un warning y sigue sin bloquear (`missing_webhook_secret`), lo cual sería un riesgo si se perdiera esa variable en un futuro deploy.
- 🔴 **CRÍTICO — Monto de pago controlado por el cliente sin validación server-side.** En `functions/mercadoPagoCheckoutPro.js`, tanto `mercadoPagoCreateTurnoPreference` (línea ~292), `mercadoPagoCreateTournamentPreference` (línea ~981) como `mercadoPagoCreateLeaguePreference` (línea ~1110) toman el monto a cobrar directamente de `payload.amount` enviado por el cliente, con la única validación `amount > 0`:
  ```js
  const amount = normalizeMoney(payload.amount);
  ...
  unit_price: amount,
  ```
  No hay ninguna lectura de Firestore para comparar ese monto contra el precio real guardado en el documento correspondiente (por ejemplo, `turnoReservations/{id}.price`, que sí existe como campo canónico según `src/services/turnosService.js`). Un cliente modificado (proxy de red, app parchada, llamada directa a la Cloud Function) podría crear una preferencia de pago por $1 para una reserva/torneo/liga que cuesta miles de pesos, y el dinero iría a la cuenta de Mercado Pago del organizador igual que un pago legítimo. Esto es un riesgo económico real y directo, no solo teórico.
  **Recomendación:** antes de crear la preferencia, la Cloud Function debe leer el precio real desde Firestore (usando `reservationId`/`tournamentId`+`registrationId`/`leagueId`+contexto) con Admin SDK y usar ese valor, ignorando `payload.amount` (o validando que coincidan exactamente).
- **Google Play Billing policy**: los pagos de turnos (reserva de cancha real), torneos y ligas (inscripción a eventos deportivos reales) son pagos por bienes/servicios del mundo físico, que están exceptuados de la obligación de usar Google Play Billing. Los "planes de organizador" (Nexo Simple/Plus/Premium, que desbloquean funcionalidad digital dentro de la app) **no tienen un flujo de compra in-app**: se activan/asignan manualmente desde el panel de admin (`assignOrganizerPlan` en `functions/adminActions.js`), no hay ningún botón de "comprar plan" con Mercado Pago dentro de la app auditada. Esto reduce el riesgo de conflicto con la política de Play Billing para contenido digital, ya que ese contenido digital no se vende in-app.

🟢 CORRECTO — verificación de pagos vía API de Mercado Pago (no confía en el body del webhook), firma de webhook implementada correctamente, credenciales de producción bien separadas del repo, planes de organizador no se venden in-app (bajo riesgo de conflicto con Play Billing).
🔴 CRÍTICO — monto de pago no validado server-side contra el precio real (turnos, torneos, ligas).
🟡 RECOMENDADO — confirmar en runtime que `MERCADO_PAGO_WEBHOOK_SECRET` esté cargado en el deploy actual de Cloud Functions (para que la validación de firma no caiga en el modo "sin validar").

---

## 14. ELIMINACIÓN DE CUENTA

Accesible desde `ProfileModal.js` ("Eliminar cuenta", con modal de confirmación). Flujo real (`AuthContext.js` → `deleteAccount`):
1. `hideUserProfile(uid)`: marca `accountDeleted: true` y `deletedAt` en Firestore.
2. `deleteCurrentUserAccount(...)`: borra el usuario de Firebase Auth (con reautenticación automática vía Google si `auth/requires-recent-login`).
3. `deleteUserProfileData(uid)`: borra la foto de Storage (`profileImages/{uid}`), el `organizerRequests/{uid}`, el subdocumento `users/{uid}/private/contact` y el documento `users/{uid}`.
4. Si algo falla después de borrar el usuario de Auth, se revierte `accountDeleted: false` (buen manejo de error parcial).

🟠 **IMPORTANTE — Borrado incompleto de datos generados por el usuario.** El flujo de autoeliminación **no** limpia: `conversations`/`messages` donde participó, `invitations` (enviadas/recibidas), `leagueRegistrationRequests`, inscripciones a torneos/ligas, `turnoReservations`, `leagueFavorites`, `userBlocks`, ni `reports` hechos por o sobre ese usuario. Esos documentos quedan en Firestore referenciando un UID que ya no existe en Auth ni en `users/`. Es una brecha frente a lo que normalmente se espera en una política de privacidad ("al eliminar tu cuenta, eliminamos tus datos personales") y frente a la sección de eliminación de cuenta que Google Play pide describir en la ficha de la app.

🟠 **IMPORTANTE — El email no queda bloqueado en la autoeliminación.** `blockedEmails` solo se escribe desde la Cloud Function `deleteUserAccount` (borrado hecho por un **admin**), no desde el flujo de autoeliminación del propio usuario. Esto es coherente con el diseño (bloquear el email es una decisión "punitiva" de admin), pero conviene tenerlo claro: un usuario que se autoelimina puede volver a registrarse con el mismo email inmediatamente después, lo cual es aceptable como comportamiento de producto pero debe describirse correctamente en la política de privacidad (no es "no podrás volver a usar tu cuenta").

🟢 CORRECTO — reautenticación manejada correctamente antes de borrar de Auth, revert si algo falla a mitad de camino, confirmación explícita en la UI.

---

## 15-17. POLÍTICA DE PRIVACIDAD, TÉRMINOS Y CONTACTO

- **Política de privacidad**: enlazada en `RegisterScreen.js` → `https://www.padelnexo.com.ar/politica-privacidad` (se abre con `Linking.openURL`).
- **Términos y condiciones**: enlazados en `RegisterScreen.js` → `https://www.padelnexo.com.ar/terminos-condiciones`. Hay un **checkbox real** (`termsAccepted`, controlado por estado, no premarcado) que bloquea el registro si no está tildado (`"Falta aceptar los términos"`). Esto confirma lo mencionado en el contexto: el checkbox de aceptación real ya existe.
- 🟠 **IMPORTANTE — la aceptación de Términos/Privacidad no queda registrada como dato persistente.** El checkbox solo controla el flujo del formulario en memoria; no se encontró ningún campo (`termsAcceptedAt`, `termsVersion`, etc.) que se guarde en `users/{uid}` al crear el perfil (`createUserProfile` en `userService.js` no incluye ese dato). Ante una disputa o auditoría, no hay evidencia server-side de que un usuario específico aceptó los términos vigentes en el momento del registro.
- **Contacto/soporte**: visible en `ProfileModal.js` como enlace `mailto:soporte.padelnexo@gmail.com` ("Ayuda y soporte"), coincide con lo indicado en el contexto.

🟢 CORRECTO — enlaces reales a política de privacidad y términos, apuntando al dominio real de PadelNexo; checkbox de aceptación no premarcado y obligatorio; email de soporte visible y accesible desde el perfil.
🟠 IMPORTANTE — falta persistir la aceptación de términos (ver arriba).

---

## 18. PERMISOS ANDROID DECLARADOS VS. USADOS

`app.json` → `android.permissions`: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`.

| Permiso | Declarado en | Usado en | Riesgo |
|---|---|---|---|
| `INTERNET` / `ACCESS_NETWORK_STATE` | `app.json` | Implícito (Firebase, fetch a Cloud Functions/Mercado Pago) | 🟢 Ninguno |
| `CAMERA` | `app.json` + plugin `expo-image-picker` (`cameraPermission`) | No se encontró un `launchCameraAsync` explícito en el código revisado; `ImagePicker.launchImageLibraryAsync` es lo que se usa en `ProfileModal.js`, `LeaguePaymentsScreen.js`, `TournamentPaymentsScreen.js`, `TournamentDetailScreen.js`, `CreateTournamentScreen.js`. El permiso de cámara puede venir declarado "por si acaso" a través del plugin de `expo-image-picker`, que agrega el permiso de cámara aunque solo se use la galería. | 🟡 Revisar si realmente se abre la cámara en algún flujo no detectado, o si se puede quitar `cameraPermission` del plugin si no se usa. |
| `READ_MEDIA_IMAGES` | `app.json` | Selección de imágenes (perfil, logo organizador, comprobantes) | 🟢 Justificado |
| `READ_MEDIA_VIDEO` | `app.json` | **No se encontró ningún uso de video** — todos los `ImagePicker` revisados usan `mediaTypes: ImagePicker.MediaTypeOptions.Images` exclusivamente | 🟡 Permiso declarado sin uso real; bajo riesgo de fricción en la revisión de Play, pero conviene quitarlo si no se planea soportar video. |
| Ubicación (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) | No aparece en la lista manual de `android.permissions`, pero el plugin `expo-location` los inyecta automáticamente en el manifest generado (comportamiento estándar de Expo config plugins) | `src/services/locationService.js` (`requestForegroundPermissionsAsync`, `getCurrentPositionAsync`) | 🟢 Justificado, con texto de permiso configurado (`locationWhenInUsePermission`) |
| Notificaciones (`POST_NOTIFICATIONS`, Android 13+) | Inyectado por el plugin `expo-notifications` | No hay registro real de push token (ver sección 21) | 🟡 Se pedirá el permiso de notificaciones al usuario aunque la función de push no esté conectada — inconsistente de cara al usuario. |

🟡 RECOMENDADO — limpiar permisos declarados sin uso real (`READ_MEDIA_VIDEO`, posiblemente `CAMERA` si nunca se abre la cámara nativa) antes de publicar, para minimizar la superficie de permisos sensibles que Google Play evalúa.

---

## 19. UBICACIÓN

`src/services/locationService.js`: usa `expo-location` con **GPS real** (`Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`), pidiendo permiso de foreground (`requestForegroundPermissionsAsync`) y devolviendo un error claro y accionable si el permiso se rechaza o si el GPS no puede resolver la posición ("Revisa que el GPS esté activo…"). También hay `geocodeAddress` (dirección → coordenadas) para complejos.

Aparte del GPS real, el flujo principal de localidad del usuario (registro/perfil) **no depende del GPS**: usa un selector de localidad de una lista (`LocationPicker.js`), que primero busca en un dataset local embebido (`data/locations.json`, localidades argentinas) y, si no encuentra nada, cae a la colección `locations` de Firestore (de solo lectura según las reglas). Es decir: la localidad del perfil es manual/por lista, y el GPS real solo se usa puntualmente (por ejemplo, para geocodificar la dirección de un complejo o buscar por cercanía).

🟢 CORRECTO — GPS real implementado con manejo de error y de permiso denegado; localidad de perfil no depende de GPS y funciona sin él (selector con dataset local + fallback a Firestore).

---

## 20. CÁMARA Y GALERÍA

- Librería: `expo-image-picker` (`^17.0.11`).
- Flujo: `requestMediaLibraryPermissionsAsync()` → si no está `granted`, muestra un feedback ("Se necesita permiso para acceder a la galería") y no continúa; si está concedido, `launchImageLibraryAsync({ mediaTypes: Images, allowsEditing: true, quality: 0.7–0.8 })`.
- Comportamiento si se rechaza el permiso: no crashea, muestra mensaje al usuario y aborta la acción — patrón consistente en todos los puntos donde se usa (`ProfileModal.js`, pantallas de pagos, creación de torneo).
- Textos de permiso configurados tanto en el plugin de `expo-image-picker` como en `infoPlist` (iOS): mencionan explícitamente "fotos de perfil" y "comprobantes de pago".

🟢 CORRECTO — manejo de permiso denegado sin crash, mensajes claros al usuario, compresión de imagen aplicada (`quality`).

---

## 21. NOTIFICACIONES

- Dependencia instalada: `expo-notifications` (`~0.32.17`), configurada como plugin en `app.json` con color de canal Android.
- Existe infraestructura de datos para push: `saveUserPushToken`, `getUserPushTokens`, `sendExpoPushNotificationAsync` (usa la API pública `https://exp.host/--/api/v2/push/send`), y funciones de alto nivel como `sendPaymentReminderPushAsync`/`sendTournamentPaymentReminderPushAsync` en `src/services/pushNotificationsService.js`.
- 🟠 **IMPORTANTE — el registro real de push token es un no-op.** La función `registerForPushNotificationsAsync(uid)` (la que se llama desde `AuthContext.js` al loguearse) tiene este cuerpo completo:
  ```js
  export async function registerForPushNotificationsAsync(uid) {
    devLog("[pushNotificationsService] Push notifications disponibles solo en builds nativos (EAS Build)");
    return null;
  }
  ```
  No se encontró en ningún lugar del proyecto una llamada a `Notifications.getExpoPushTokenAsync()`, `Notifications.setNotificationHandler()`, ni a `Notifications.requestPermissionsAsync()`. Es decir: aunque ya hay builds nativos generados por EAS (donde el comentario dice que "se activará automáticamente"), el código para activarlo **todavía no está escrito** — es un placeholder, no una limitación real del entorno Expo Go. El sistema de "recordatorio de pago" (`sendPaymentReminderPushAsync`) no tiene ningún token real que enviar, porque `pushTokens`/`expoPushToken` nunca se guardan.
  Aparte de esto, existe un mecanismo distinto de "notificación in-app" vía chat de sistema (`turnosNotificationsService.js` envía mensajes a una conversación `padelnexo-system`), que sí funciona, pero solo es visible si el usuario abre la app y entra a Mensajes — no es una notificación push del sistema operativo.
- **Configuración pendiente para producción**: falta el `projectId` de EAS pasado a `getExpoPushTokenAsync({ projectId })`, la solicitud de permiso, el guardado real del token, y (si se quiere push nativa vía FCM en vez de Expo push service) la integración con `@react-native-firebase/messaging`, que no está instalado.

🔴 Nota de clasificación: se marca como 🟠 IMPORTANTE (no crítico) porque no bloquea el uso principal de la app, pero es una funcionalidad anunciada por la infraestructura (plugin instalado, textos de permiso) que hoy no cumple ninguna función real — debería completarse o, si se decide postergarla, quitar el plugin/permiso para no generar expectativas ni pedir un permiso sin uso.

---

## 22. CRASHLYTICS

`App.js` implementa Crashlytics de forma robusta:
- `@react-native-firebase/crashlytics` + `@react-native-firebase/app`, ambos como plugins en `app.json`.
- `getCrashlyticsSafe()` envuelve cualquier llamada a `crashlytics()` en un try/catch, para no romper el arranque si el módulo nativo no está compilado en el binario instalado (coincide con el fix reciente mencionado en el contexto: "no romper el arranque si el módulo nativo no está disponible").
- `setCrashlyticsCollectionEnabled(true)` al arrancar.
- Se envuelve `ErrorUtils.getGlobalHandler()` para mandar a Crashlytics los errores JS no capturados por React, sin perder el comportamiento nativo por defecto (redbox en dev, etc.).
- `promise/setimmediate/rejection-tracking` está habilitado (`allRejections: true`) para capturar promesas rechazadas sin `.catch()` y mandarlas también a Crashlytics.
- `RootErrorBoundary` (React error boundary) también reporta a Crashlytics y, además, muestra en pantalla el mensaje/stack del error — útil para debug en builds internos, pero conviene confirmar que ese detalle técnico no quede visible para usuarios finales en el build de producción (hoy no hay ninguna bandera que lo oculte solo en producción; se muestra siempre que ocurre un error no capturado).

🟢 CORRECTO — Crashlytics implementado de forma defensiva (no rompe el arranque si el módulo nativo falta), con cobertura de errores globales y de promesas sin catch, que son las dos fuentes más comunes de crashes reales en RN.
🟡 RECOMENDADO — la pantalla de `RootErrorBoundary` expone mensaje y stack trace completos al usuario final en cualquier build, incluido producción; considerar mostrar un mensaje genérico en producción y dejar el detalle técnico solo para development/preview.
NO VERIFICABLE DESDE EL PROYECTO — que Crashlytics esté recibiendo eventos reales en la consola de Firebase (requiere un build nativo real ejecutándose, comprobación manual).

---

## 23. MANEJO DE ERRORES

Patrón dominante y consistente en todo el código: `try/catch` con mensajes de error traducidos al usuario vía `getFirebaseErrorMessage`/mensajes propios, y uso extendido de `.catch(() => {})` para operaciones "best effort" que no deben interrumpir el flujo principal (por ejemplo, sincronizar el estado de un pago, registrar el push token, loguear una acción de admin).

- No se detectaron llamadas async sin ningún manejo dentro de los servicios revisados (`userService.js`, `authService.js`, `mercadoPagoCheckoutService.js`, `AuthContext.js`).
- `App.js` tiene una capa adicional de seguridad: `RootErrorBoundary` para errores de render, y el handler global de `ErrorUtils` + rejection-tracking para todo lo que ocurre fuera de React — cubre razonablemente bien el peor caso ("promesa sin catch en un event handler").
- Los componentes que leen datos de Firestore usan valores por defecto extensivamente (`profileDoc.nombre || "Jugador"`, `Array.isArray(x) ? x : []`, etc. en `userService.js`/`mapDocToUserData`) — buena defensa contra documentos con campos `null`/ausentes.

🟢 CORRECTO — patrón de manejo de errores consistente y con una red de seguridad global (Crashlytics + ErrorBoundary + rejection tracking) poco común de ver ya resuelta en un proyecto de este tamaño.
🟡 RECOMENDADO — no se hizo una revisión línea por línea de las 33 pantallas; se recomienda una pasada de `eslint` con la regla `no-floating-promises` (requiere TypeScript o un plugin específico) antes del release final para tener cobertura exhaustiva, no solo una muestra.

---

## 24. OFFLINE / CONEXIÓN

- No se encontró la librería `@react-native-community/netinfo` ni ningún chequeo explícito de conectividad (`isConnected`) en el proyecto.
- Firestore se inicializa con `experimentalForceLongPolling: true` (`services/firebaseConfig.js`) — esto es una configuración de transporte de red (evita problemas de WebChannel/streaming en ciertas redes/proxies), no un mecanismo de cache offline explícito, aunque el SDK de Firestore igualmente mantiene su propia cola de escritura offline por defecto.
- El manejo de "sin conexión" queda delegado a los mismos `try/catch` genéricos: si `fetch`/Firestore fallan, se muestra un mensaje de error genérico ("No pudimos conectar…", "Intentá nuevamente…"), no hay una pantalla o banner dedicado de "estás sin conexión".
- Los timeouts hacia Mercado Pago/Cloud Functions no tienen un `AbortController` explícito detectado; dependen del timeout por defecto de `fetch` (en RN, indefinido salvo que el servidor cierre la conexión).

🟡 RECOMENDADO — agregar detección de conectividad explícita (NetInfo) para mostrar un estado claro de "sin conexión" en vez de errores genéricos, y considerar timeouts explícitos en los `fetch` a Cloud Functions/Mercado Pago para evitar loaders colgados indefinidamente en redes muy lentas.
🟢 CORRECTO — no se detectaron pantallas que crasheen directamente por falta de conexión; el patrón de `try/catch` + mensaje de error es aplicado consistentemente.

---

## 25. AUTENTICACIÓN Y SEGURIDAD (revisión específica)

- No se encontraron contraseñas guardadas manualmente en `AsyncStorage` — solo se persiste `lastLoginEmail` (email, no contraseña) en `AsyncStorage` bajo la key `@padelnexo:last-login-email`, para prellenar el campo de login. Esto es un dato de bajo riesgo.
- La sesión de Firebase Auth persiste vía el mecanismo propio del SDK (`getReactNativePersistence(AsyncStorage)`), que es el patrón oficial recomendado por Firebase para RN — el token de sesión lo administra el propio SDK, no código propio.
- No se encontró ningún `console.log` de credenciales, tokens o contraseñas. Todo el logging de desarrollo pasa por `devLog` (`src/utils/devLog.js`), que es un **no-op en producción**:
  ```js
  const devLog = __DEV__ ? console.log.bind(console) : () => {};
  ```
  Se usa de forma extendida en servicios y pantallas (incluye mensajes con URLs de descarga, uids, payloads de checkout) — al ser no-op fuera de `__DEV__`, esos datos no llegan a la consola en el build de producción/AAB.
- No se encontró ningún `console.log`/`console.warn`/`console.error` "crudo" (sin pasar por `devLog`) en `src/`, y tampoco en `App.js`.

🟢 CORRECTO — no hay contraseñas ni tokens persistidos manualmente, el único dato en `AsyncStorage` propio es un email para UX; todo el logging de desarrollo está centralizado y desactivado en producción.

---

## 26-27. CONTENIDO GENERADO POR USUARIOS, MODERACIÓN Y MENSAJERÍA

- **Bloqueo entre usuarios**: `src/services/blockingService.js` — colección `userBlocks`, con `blockUser`/`unblockUser`/`subscribeToBlockedUsers`/`getConversationBlockStatus`. Reglas de Firestore permiten que solo el propio `blockerId` lea/escriba sus bloqueos.
- **Reporte de usuarios/contenido**: `src/services/reportsService.js` — colección `reports`, con `submitReport` (cliente), `listAdminReports`/`updateReportStatus` (panel de admin). Reglas: solo el propio reportante o un admin pueden leer/actualizar un reporte; cualquier autenticado puede crear uno.
- **UI de reporte**: existe `ReportModal.js` como componente reutilizable.
- **Restricción por edad en el chat**: `chatHabilitado` se calcula en el registro/actualización de perfil a partir de `fechaNacimiento` (`calcularEdad(...) >= 14`) y las reglas de Firestore exigen `chatHabilitado == true` (o rol organizador) para poder usar `conversations`/`messages` — es una moderación real a nivel de reglas, no solo de UI.
- **Mensajería — quién puede leer/escribir/borrar**:
  - `conversations/{id}`: lectura solo si `request.auth.uid in participants` (y si tiene chat habilitado, o es la conversación de sistema `padelnexo-system`); escritura equivalente.
  - `messages` (subcolección): **solo `read` y `create`** están permitidos por las reglas — no hay `update` ni `delete` habilitados para nadie desde el cliente, lo cual hace que los mensajes sean efectivamente inmutables una vez enviados (ni el autor ni el destinatario pueden editarlos o borrarlos). Es una decisión de diseño razonable para preservar evidencia ante un reporte, aunque puede ser un problema de UX si se espera poder borrar un mensaje propio.
  - No se detectó ninguna función que permita a un usuario borrar toda una conversación desde el cliente (coherente con las reglas).

🟢 CORRECTO — hay mecanismos reales de bloqueo y reporte (no es un placeholder), con reglas de Firestore que los respaldan; el chat está restringido por edad a nivel de reglas (no solo de UI, que sería fácil de saltear); los mensajes son inmutables una vez creados, lo cual es positivo para moderación.
🟡 RECOMENDADO — no se identificó un flujo de moderación proactiva (por ejemplo, un admin viendo el contenido de una conversación reportada) más allá de `listAdminReports`; confirmar en `AdminScreen.js` si el panel de admin permite revisar el detalle de un reporte de mensaje.

---

## 28. PERFILES DE USUARIO — PÚBLICO VS. PRIVADO

Confirmado el patrón `users/{uid}/private/contact` mencionado en el contexto:
- **Privado** (subcolección `private/contact`, solo el dueño puede leer/escribir): `email` real, `telefono` real, `countryCode`, `phoneCountry`.
- **Público** (documento `users/{uid}`): nombre, categoría, sexo, lado de juego, mano hábil, descripción, foto de perfil, avatar/color, localidad (ciudad/provincia/país, sin coordenadas de precisión), disponibilidad horaria, complejos (si es organizador), y **el teléfono solo si el usuario activó "Mostrar celular"** (`mostrarTelefono`) — en ese caso se copia una versión pública del teléfono al documento principal (`telefono` en `users/{uid}`), manteniendo igual el original en `private/contact`.
- El panel de administración no lee el email/teléfono directo de Firestore desde el cliente: lo pide a la Cloud Function `listAdminUsersData`, que sí tiene permiso vía Admin SDK para leer la subcolección `private` de todos los usuarios. Diseño correcto: el cliente admin nunca necesita permiso de lectura ancha sobre `private/*` en las reglas.

🟢 CORRECTO — separación público/privado implementada de forma consistente entre reglas de Firestore y código de aplicación; el teléfono solo se hace público si el usuario lo elige explícitamente.

---

## 29. DATOS DE PAGO ALMACENADOS

- No se encontró que la app guarde números de tarjeta, CVV ni datos bancarios — el checkout de pagos se delega íntegramente a Mercado Pago Checkout Pro (WebView/navegador externo gestionado por Mercado Pago), la app solo maneja: `paymentId`, `mercadoPagoStatus`, `paymentStatus`, `paymentMethod`, `externalReference` y (en turnos) comprobantes de transferencia subidos como imagen cuando el método es "transferencia".
- La configuración de cuenta de Mercado Pago del organizador (`mercadoPagoConfig` en `users/{uid}`) guarda solo metadatos de vinculación (`accountLinked`, `accountDisplayName`, `connectionStatus`, categorías habilitadas) — no credenciales de Mercado Pago del organizador en texto plano en Firestore (el Access Token/Refresh Token de la cuenta vinculada por OAuth debería vivir server-side; no se identificó que se exponga al cliente, aunque no se auditó línea por línea `mercadoPagoOAuth.js` completo).
- Comprobantes de pago (imágenes subidas por el jugador para pagos por transferencia) se identificaron como funcionalidad real en `LeaguePaymentsScreen.js`/`TournamentPaymentsScreen.js`, pero no se confirmó con certeza a qué ruta de Storage se suben (ver sección 11).

Para la tabla de **Data Safety** de Google Play, lo que corresponde declarar como "datos financieros" es, como mínimo: identificadores de pago de Mercado Pago (`paymentId`, `externalReference`), estado de pago, y comprobantes de transferencia (imágenes) si aplica — no números de tarjeta ni CVV (esos nunca pasan por la app).

🟢 CORRECTO — no se almacenan datos de tarjeta/CVV/bancarios en la app; el checkout sensible queda delegado a Mercado Pago.
🟡 RECOMENDADO — confirmar la ruta exacta de Storage donde se suben los comprobantes de transferencia, y asegurar que las Storage Rules (sección 11) restrinjan su lectura solo al jugador, al organizador de esa reserva/torneo/liga y a un admin.

---

## 30. GOOGLE PLAY DATA SAFETY (tabla basada en el código real)

| Dato | Se recopila | Se comparte | Finalidad | Obligatorio/posible |
|---|---|---|---|---|
| Nombre | Sí (`users.nombre`) | No (visible entre usuarios de la app, no con terceros externos) | Funcionalidad de la app (perfil, jugadores, ligas) | Obligatorio |
| Email | Sí (`users/{uid}/private/contact.email`) | Sí, con Mercado Pago (como email del pagador en la preferencia de checkout) y con el proveedor de email transaccional (Resend, para bienvenida/reset de contraseña/avisos de plan) | Autenticación, comunicación, checkout de pagos | Obligatorio |
| Teléfono | Sí (`users/{uid}/private/contact.telefono`) | Solo si el usuario activa "Mostrar celular" (se comparte con otros usuarios de la app) | Contacto entre jugadores/organizadores | Obligatorio para registrarse; visibilidad opcional |
| Ubicación | Sí — localidad manual (ciudad/provincia/país) siempre; coordenadas GPS solo si el usuario concede el permiso puntual (`expo-location`) | No a terceros; se usa dentro de la app (cercanía, complejos) | Mostrar jugadores/complejos/turnos cercanos | Localidad manual: obligatoria. GPS preciso: opcional |
| Fotos | Sí (foto de perfil, logo de organizador, comprobantes de pago) | Entre usuarios de la app (foto de perfil es pública) | Personalización de perfil, verificación de pagos por transferencia | Opcional (perfil/logo), obligatorio si se paga por transferencia |
| Mensajes | Sí (colección `conversations`/`messages`) | Entre los participantes de la conversación únicamente | Coordinar partidos, comunicación organizador-jugador | Opcional (funcionalidad de mensajería) |
| Actividad en la app (ligas, torneos, turnos, favoritos, invitaciones) | Sí | No a terceros | Funcionalidad principal de la app | Obligatorio para usar esas funciones |
| Pagos / información financiera | Identificadores y estado de pago de Mercado Pago (`paymentId`, `externalReference`, `paymentStatus`); no se recopilan datos de tarjeta | Sí, con Mercado Pago (procesador de pagos) | Procesar pagos de turnos/torneos/ligas | Obligatorio para pagar por Mercado Pago (hay alternativas: efectivo/transferencia según el flujo) |
| Identificadores (UID de Firebase, push token cuando exista) | Sí (`uid` de Firebase Auth) | No a terceros (interno) | Autenticación y funcionamiento de la app | Obligatorio |
| Diagnósticos / datos de fallos (Crashlytics) | Sí (errores, stack traces) | Con Firebase/Google (proveedor de infraestructura) | Estabilidad y corrección de errores | Obligatorio (recolección automática, no opt-in visible en el código) |

🟡 RECOMENDADO — completar el cuestionario de Data Safety en Play Console reflejando exactamente esta tabla; en particular, declarar Crashlytics (diagnósticos) y el email compartido con Mercado Pago/Resend, que son fáciles de omitir.

---

## 31. CLASIFICACIÓN DE CONTENIDO

Características relevantes detectadas en el código que impactan el cuestionario de clasificación de contenido de Play Console:
- **Interacción entre usuarios**: sí (mensajería, invitaciones, ligas/torneos compartidos).
- **Mensajes/chat entre usuarios**: sí, con restricción por edad (≥14) a nivel de reglas.
- **Fotos/contenido generado por el usuario**: sí (fotos de perfil, logos, comprobantes), sin moderación automática de contenido de imagen detectada (solo reporte manual posterior).
- **Ubicación del usuario**: sí, con uso justificado (cercanía deportiva).
- **Pagos dentro de la app**: sí, para bienes/servicios reales (turnos, inscripciones), vía Mercado Pago.
- **Deporte/competencia**: temática deportiva (pádel), sin contenido violento/apuestas.

Recomendación: al completar el cuestionario de IARC/Play, marcar explícitamente "los usuarios pueden interactuar" y "comparten su ubicación" y "la app incluye compras" (aunque sean de servicios reales, Play igual pregunta por presencia de pagos). No se identificó contenido para adultos, apuestas ni violencia.

NO VERIFICABLE DESDE EL PROYECTO — el cuestionario de clasificación en sí se completa en Play Console; esto es solo una guía basada en lo verificado en código.

---

## 32. RIESGOS DE GOOGLE PLAY POLICY (evaluación de riesgo, no veredicto)

| Área | Riesgo | Detalle |
|---|---|---|
| Privacidad | 🟡 Medio-bajo | Falta persistir consentimiento de términos (sección 16); Storage Rules no verificables (sección 11) |
| Permisos | 🟡 Bajo | `READ_MEDIA_VIDEO` sin uso real; posible `CAMERA` sin uso real |
| Contenido de usuarios | 🟢 Bajo | Hay reporte y bloqueo reales, chat restringido por edad |
| Pagos/suscripciones | 🔴 Medio-alto | Vulnerabilidad de manipulación de monto (sección 13) es un riesgo de fraude real, no solo de policy; en cuanto a Play Billing, riesgo bajo porque los pagos son de bienes/servicios reales y los planes digitales no se venden in-app |
| Cuentas y eliminación de cuenta | 🟠 Medio | Eliminación de cuenta parcial (huérfanos en Firestore) — Play exige que la app permita eliminar la cuenta y sus datos asociados; hoy elimina la cuenta pero no todos los datos asociados |
| Información engañosa | 🔴 Medio-alto | `playersMock` mostrado como fallback a usuarios reales (sección 39) es el punto más delicado: mostrar jugadores inexistentes como si fueran reales puede leerse como contenido engañoso |
| Funcionalidad incompleta | 🟠 Medio | Push notifications no funcional pese a la infraestructura visible (permiso solicitado sin función real) |

Esta tabla es una evaluación de riesgo relativo basada en el código, **no** un veredicto de aprobación/rechazo de Google Play (eso depende de la revisión humana/automática de Google).

---

## 33. REFERENCIAS A LA WEB PADELNEXO

- `RegisterScreen.js`: `https://www.padelnexo.com.ar/terminos-condiciones`, `https://www.padelnexo.com.ar/politica-privacidad`.
- `App.js`: enlaces a Google Play (`https://play.google.com/store/apps/details?id=com.padelnexo.app`) para el flujo de actualización obligatoria/sugerida (ver `appConfig/versionControl` en Firestore, controla `minAndroidVersion`/`latestAndroidVersion`).
- No se encontraron URLs de eliminación de cuenta específicas en la web (la eliminación de cuenta es 100% in-app, no requiere una URL externa según lo exigido por Play cuando el flujo está disponible dentro de la app — que es el caso aquí).
- Email de soporte: `soporte.padelnexo@gmail.com` (no un formulario web).
- No se usó ninguna herramienta externa para acceder a la web real; solo se registran las URLs tal como aparecen hardcodeadas en el código de la app.

🟢 CORRECTO — URLs de privacidad/términos apuntan al dominio real de PadelNexo (`padelnexo.com.ar`), consistente con el proyecto hermano `padelnexo-web`.

---

## 34. LOGOS / ICONOS / SPLASH

`app.json`:
- `icon`: `./assets/icon.png` — existe (1.18 MB).
- `splash.image`: `./assets/padelnexo-logo-full.png` — existe (835 KB), `resizeMode: contain`, `backgroundColor: #F4F6F8`.
- `android.adaptiveIcon.foregroundImage`: `./assets/adaptive-icon.png` — existe (341 KB).
- Todos los assets referenciados en `app.json` están presentes en `assets/`.
- Hay además `assets/loading-icon-rounded.png` (usado presumiblemente en `PadelNexoLoadingOverlay.js`, no referenciado desde `app.json`).
- Los archivos `LOGO PADEL NEXO.png` y `LOGOSINFONDO2.png` en la raíz del repo no están referenciados en `app.json` (son fuente/histórico) y `LOGO PADEL NEXO.png` está además en `.gitignore`.

🟢 CORRECTO — todos los assets de icon/splash/adaptive-icon referenciados en `app.json` existen físicamente en el repo.
🟡 RECOMENDADO — verificar tamaño/formato del ícono adaptativo (Google Play exige un ícono de 512×512 para la ficha de Play, separado del `adaptive-icon.png` de la app) — esto se sube directo en Play Console. NO VERIFICABLE DESDE EL PROYECTO.

---

## 35-36. DEPENDENCIAS Y EXPO

Versión Expo `~54.0.36`, React Native `0.81.5`, React `19.1.0` — combinación coherente entre sí (SDK 54).

Dependencias con módulo nativo (requieren rebuild de EAS, no solo JS bundle, ante cualquier cambio de versión): `@react-native-async-storage/async-storage`, `@react-native-community/datetimepicker`, `@react-native-firebase/app` y `@react-native-firebase/crashlytics` (`^26.1.0`), `@react-native-google-signin/google-signin` (`^16.1.2`), `expo-dev-client`, `expo-image-picker`, `expo-location`, `expo-notifications`, `expo-print`, `expo-sharing`, `expo-updates`, `react-native-screens`, `react-native-share`, `react-native-view-shot`.

- `firebase` (`^12.11.0`) es el SDK JS puro (no `@react-native-firebase` para Auth/Firestore/Storage) — el proyecto mezcla el SDK JS de Firebase (Auth/Firestore/Storage) con `@react-native-firebase` (solo para App + Crashlytics). Es una combinación válida y común en proyectos Expo (Crashlytics requiere módulo nativo sí o sí, el resto se puede usar en JS puro), pero conviene tenerlo presente porque implica dos "mundos" de Firebase inicializándose en la misma app.
- Varias dependencias usan rangos `^` (caret) en vez de fijas (`@react-native-firebase/*`, `@react-native-google-signin/google-signin`, `expo-image-picker`, `firebase`, `react-native-share`) — con `^`, una reinstalación futura de `node_modules` podría traer una versión menor/parche distinta a la que se usó en el build de producción ya generado, sin que quede registrado en el repo qué versión exacta se compiló. `package-lock.json` sí fija las versiones exactas instaladas hoy, lo cual mitiga el riesgo mientras no se borre `node_modules`/`package-lock.json`.
- No se detectaron paquetes evidentemente abandonados o incompatibles con Expo SDK 54/RN 0.81 en la lista.

🟢 CORRECTO — conjunto de dependencias coherente con Expo SDK 54; `package-lock.json` presente y consistente.
🟡 RECOMENDADO — considerar fijar versiones exactas (sin `^`) para los paquetes con módulo nativo antes de un build de producción importante, para reproducibilidad exacta del build ya subido a Play.

---

## 37. PRODUCCIÓN VS. DESARROLLO — CASOS ENCONTRADOS

Búsqueda específica de `localhost`, `127.0.0.1`, IPs privadas (`192.168.*`), `ngrok`, `10.0.2.2`: **no se encontró ninguna referencia** en `src/` (el paquete `@expo/ngrok` está en dependencias, pero es una herramienta de desarrollo de Expo CLI para túneles, no una URL hardcodeada en la app).

Todos los endpoints de Cloud Functions usados en el código apuntan al proyecto y región reales: `southamerica-east1-padelnexo-7e4d5.cloudfunctions.net/...` (`authService.js`, `app.json` → `extra.mercadoPago`, `functions/.env`). No se encontraron endpoints de "test"/"staging" separados.

- `functions/.env` tiene credenciales de Mercado Pago de **producción** (no `TEST-`), como ya se detalló en la sección 13.
- `mercadoPagoConfigService.js`/`userService.js` usan como valor por defecto el string `"checkout_pro_test"` para el campo `connectionStatus` cuando un organizador todavía no vinculó su cuenta de Mercado Pago — es solo una etiqueta de estado interno ("todavía no está en modo checkout pro real"), no implica que se estén usando credenciales de test; una vez que el organizador vincula su cuenta por OAuth, ese estado cambia.
- Todo el `console.log`/logging de desarrollo pasa por `devLog` (no-op en producción), como ya se detalló en la sección 25 — no hay fugas de logs de desarrollo en el build de producción.
- No se encontraron `TODO`/`FIXME`/`XXX` en `src/` (búsqueda específica sin resultados).
- No se encontraron datos de prueba obvios en Firestore (no se puede inspeccionar el contenido real de la base desde el repo, solo el código que la lee/escribe) — **NO VERIFICABLE DESDE EL PROYECTO** si hay documentos de prueba cargados en la base de datos real de producción (`padelnexo-7e4d5`).

🟢 CORRECTO — sin URLs de desarrollo/localhost hardcodeadas, sin credenciales de test en el flujo de producción, sin TODOs pendientes, logging de desarrollo correctamente desactivado en producción.

---

## 38. BASE DE DATOS DE LOCALIDADES ARGENTINAS

- Dataset local embebido: `data/locations.json`, cargado y normalizado en `LocationPicker.js` (`LOCAL_LOCATIONS`), con búsqueda por prefijo normalizada (sin acentos, minúsculas).
- Fallback a Firestore: colección `locations` (solo lectura desde el cliente según `firestore.rules`, `allow write: if false` — "nadie escribe acá desde la app"), usada solo cuando el dataset local no encuentra resultados.
- No se detectaron datos de prueba evidentes en el dataset local (son localidades reales de Argentina con provincia y país).

🟢 CORRECTO — dataset de referencia real, de solo lectura, con fallback razonable; no se identificaron datos de prueba.

---

## 39. FUNCIONALIDADES PRINCIPALES — TODO/FIXME, FUNCIONES VACÍAS, MOCKS, PLACEHOLDERS

- Búsqueda de `TODO`/`FIXME`/`XXX` en `src/`: **sin resultados**.
- 🔴 **CRÍTICO — Datos de jugadores falsos (`playersMock`) usados como fallback en producción.** Confirmado en tres pantallas:
  - `src/screens/JugadoresScreen.js` (línea ~191): `const sourcePlayers = players.length > 0 ? players : playersMock;` — y también en el `catch` del error de carga (línea ~195): `setPlayersSource(registerPlayersForFavorites(currentUserId, playersMock));`.
  - `src/screens/FavoritosScreen.js` (líneas ~30 y ~38): mismo patrón.
  - `src/screens/PlayerDetailScreen.js` (línea ~42): busca el jugador por id primero en los datos reales y, si no lo encuentra, en `playersMock`.
  - `src/data/playersMock.js` contiene jugadores completamente inventados (`"Agustin Romero"`, `"Lucia Fernandez"`, etc.) con fotos de un servicio externo de avatares aleatorios (`https://i.pravatar.cc/240?img=...`), disponibilidad horaria falsa y ciudades argentinas reales.
  - **Esto significa que cualquier usuario real en una ciudad donde todavía no haya jugadores registrados (algo esperable al lanzar la app) va a ver jugadores que no existen, con fotos de personas que no son parte de la comunidad**, y lo mismo ocurre silenciosamente si la consulta a Firestore falla por cualquier motivo (el `catch` también cae a `playersMock`, ocultando el error real en vez de mostrarlo). Es el hallazgo de mayor impacto reputacional/de confianza de toda la auditoría, y es trivial de alcanzar por un usuario real (basta con ser de las primeras cuentas registradas en una ciudad, algo que va a pasar necesariamente en el lanzamiento).
  - **Recomendación:** antes de publicar, reemplazar el fallback a `playersMock` por un estado vacío explícito ("Todavía no hay jugadores cerca tuyo — invitá a tus amigos" o similar) tanto para el caso de lista vacía real como para el caso de error de carga (que además debería mostrarse como error, no ocultarse detrás de datos falsos).
- No se encontraron botones sin acción evidentes en las pantallas revisadas (`AppButton`/`Pressable` siempre tienen un `onPress` con lógica real en los archivos inspeccionados).
- No se encontraron pantallas completamente vacías/placeholder entre las 33 listadas en `src/screens/`.
- Push notifications (sección 21) es la funcionalidad más claramente "a medio construir": infraestructura de datos lista, UI y textos de permiso listos, pero sin el código de registro real de push token.

🟢 CORRECTO — no hay `TODO`/`FIXME` pendientes, no hay botones sin acción ni pantallas vacías detectadas.
🔴 CRÍTICO — `playersMock` mostrado como datos reales a usuarios de producción (ver detalle arriba).

---

## CHECKLIST FINAL

| Área | Estado | Prioridad | Problema | Acción recomendada |
|------|--------|-----------|----------|---------------------|
| Android SDK | 🟢 | — | Ninguno detectado | Confirmar en Play Console que targetSdk 36 sigue vigente al momento de subir |
| Application ID | 🟢 | — | Ninguno | — |
| Versionado | 🟢 | 🟡 | `versionCode` gestionado remotamente por EAS, no verificable desde el repo | Confirmar próximo `versionCode` en el dashboard de EAS antes del build final |
| EAS | 🟢 | — | Perfil `production` correcto (AAB, canal `production`) | Ejecutar `eas build --platform android --profile production` cuando el resto de los críticos esté resuelto |
| Firma | ⚪ No verificable | 🟠 | Estado de Play App Signing/keystore no verificable desde el repo | Confirmar manualmente en EAS/Play Console antes de la primera subida |
| Firebase Auth | 🟢 | 🟡 | Contraseña mínima de 4 caracteres es baja | Subir el mínimo a 8+ caracteres |
| Firestore | 🟢 | — | Colecciones consistentes con el código | — |
| Firestore Rules | 🟢 | — | Sin reglas abiertas, campos sensibles protegidos | Mantener el mismo criterio en futuras colecciones |
| Storage | 🟠 | 🟠 | Uso real limitado (fotos/logos/comprobantes) pero rutas de comprobantes no confirmadas del todo | Confirmar ruta exacta de comprobantes de pago |
| Storage Rules | 🔴 | 🔴 | No hay `storage.rules` en el repo ni en `firebase.json` | Verificar y versionar las reglas reales de Storage antes de publicar |
| Variables de entorno | 🟢 | — | `.env` correctamente excluidos de git en ambos proyectos | — |
| Mercado Pago | 🔴 | 🔴 | Monto de pago controlado por el cliente sin validar contra el precio real en Firestore | Validar `amount` server-side contra el precio guardado antes de crear la preferencia |
| Eliminación de cuenta | 🟠 | 🟠 | Borrado parcial (deja huérfanos), email no bloqueado en autoeliminación | Completar el borrado de datos asociados (mensajes, inscripciones, reportes, bloqueos) |
| Política de privacidad | 🟢 | 🟠 | Enlazada correctamente, pero la aceptación no se persiste | Guardar `termsAcceptedAt`/versión aceptada en el perfil al registrarse |
| Términos | 🟢 | 🟠 | Checkbox real y obligatorio, pero aceptación no persistida | Igual que arriba |
| Soporte | 🟢 | — | Email de soporte visible y accesible | — |
| Permisos | 🟡 | 🟡 | `READ_MEDIA_VIDEO` sin uso real detectado | Quitar el permiso si no se va a soportar video |
| Ubicación | 🟢 | — | GPS real + fallback por lista, con manejo de permiso denegado | — |
| Cámara/Galería | 🟢 | — | Manejo correcto de permiso denegado | — |
| Notificaciones | 🟠 | 🟠 | Push instalado/configurado pero sin registro real de token | Implementar `getExpoPushTokenAsync` + guardado de token antes del lanzamiento, o quitar el permiso si se posterga |
| Crashlytics | 🟢 | 🟡 | Implementado de forma robusta; pantalla de error muestra detalle técnico en cualquier build | Ocultar stack trace detallado en builds de producción |
| Data Safety | 🟡 | 🟡 | Tabla de datos elaborada en esta auditoría | Completar el formulario real en Play Console con esta base |
| Contenido generado | 🟢 | — | Fotos, mensajes, reseñas de perfil manejadas con reglas claras | — |
| Moderación | 🟢 | 🟡 | Bloqueo y reporte reales implementados | Confirmar flujo de revisión de reportes en el panel de admin |
| Dependencias | 🟢 | 🟡 | Varias con rango `^` en vez de versión fija | Fijar versiones antes de un build de producción importante |
| Expo | 🟢 | — | SDK 54 coherente con RN 0.81 / React 19 | — |
| Producción | 🔴 | 🔴 | `playersMock` mostrado como datos reales a usuarios en producción | Reemplazar por estado vacío/error real antes de publicar |
| Web | 🟢 | — | URLs de privacidad/términos apuntan al dominio real | — |

---

## PLAN DE ACCIÓN

### 🔴 HACER ANTES DE GENERAR AAB
1. **Validar server-side el monto de los pagos de Mercado Pago** (turnos, torneos, ligas) contra el precio real guardado en Firestore antes de crear la preferencia de Checkout Pro, en las tres Cloud Functions (`mercadoPagoCreateTurnoPreference`, `mercadoPagoCreateTournamentPreference`, `mercadoPagoCreateLeaguePreference`).
2. **Eliminar el fallback a `playersMock`** en `JugadoresScreen.js`, `FavoritosScreen.js` y `PlayerDetailScreen.js`; reemplazarlo por un estado vacío explícito y por un mensaje de error real cuando falle la consulta (no ocultar el error detrás de datos falsos).
3. **Confirmar y, si hace falta, corregir las Storage Rules** del bucket `padelnexo-7e4d5.firebasestorage.app` en la consola de Firebase (no están versionadas en el repo); si son abiertas o muy permisivas, restringirlas por dueño de carpeta (`profileImages/{uid}`, `organizerLogos/{uid}`, y la ruta real de comprobantes de pago).

### 🟠 HACER ANTES DE SUBIR A GOOGLE PLAY
4. Completar el borrado de datos asociados en la autoeliminación de cuenta (mensajes, inscripciones a ligas/torneos, invitaciones, reportes, bloqueos, `turnoReservations`, `leagueFavorites`) o, como alternativa mínima, documentar en la política de privacidad exactamente qué datos persisten tras la eliminación.
5. Persistir la aceptación de Términos y Política de Privacidad (`termsAcceptedAt`, versión aceptada) en `users/{uid}` al registrarse.
6. Completar el registro real de push token (`Notifications.getExpoPushTokenAsync` + guardado en `pushTokens`) o, si se posterga la funcionalidad, quitar el permiso de notificaciones del build para no generar una expectativa sin cumplir.
7. Confirmar en el dashboard de EAS el estado de Play App Signing / keystore antes de la primera subida (no reversible el cambio de keystore después).
8. Confirmar la ruta exacta de Storage de los comprobantes de pago y que las Storage Rules la protejan adecuadamente (jugador, organizador correspondiente y admin únicamente).
9. Completar el cuestionario de Data Safety en Play Console usando la tabla de la sección 30 como base.

### 🟡 HACER ANTES DE PUBLICACIÓN DEFINITIVA
10. Quitar el permiso `READ_MEDIA_VIDEO` (y revisar si `CAMERA` se usa realmente) si no se van a soportar esos flujos.
11. Subir la contraseña mínima de registro de 4 a 8+ caracteres.
12. Ocultar el detalle técnico (stack trace) de `RootErrorBoundary` en builds de producción, dejando solo un mensaje genérico para el usuario final.
13. Agregar detección explícita de conectividad (NetInfo) y timeouts explícitos en los `fetch` hacia Cloud Functions/Mercado Pago.
14. Fijar las versiones exactas (sin `^`) de las dependencias con módulo nativo antes del build de producción final.

### 🟢 PUEDE QUEDAR PARA DESPUÉS
15. Revisar si conviene mover el email de admin hardcodeado (`wramirez.arg@gmail.com`) a un mecanismo más flexible de administración de roles.
16. Cobertura más exhaustiva de manejo de errores (lint automatizado tipo `no-floating-promises`) más allá de la muestra revisada en esta auditoría.
17. Evaluar agregar moderación automática de imágenes (fotos de perfil/comprobantes) más allá del reporte manual, si el volumen de usuarios lo justifica.
18. Confirmar tamaño/formato del ícono de 512×512 para la ficha de Play (se sube directo en Play Console, no vive en el repo).
