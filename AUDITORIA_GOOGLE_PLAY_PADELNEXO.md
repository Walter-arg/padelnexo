# AUDITORÍA PRE-PUBLICACIÓN PADELNEXO

Fecha de auditoría: 2026-08-10
Alcance: repositorio `padel-amateur-app` (app React Native/Expo) + referencias a `padelnexo-web` y `functions/` (Cloud Functions) donde correspondía verificar contexto (Mercado Pago, política de privacidad).

Metodología: revisión estática de código y configuración real del repositorio. No se modificó, instaló, actualizó ni ejecutó ningún build. Todo lo que no pudo verificarse leyendo el proyecto está marcado explícitamente como **NO VERIFICABLE DESDE EL PROYECTO — REQUIERE COMPROBACIÓN MANUAL**.

---

## RESUMEN EJECUTIVO

**Estado general: 🟠 REQUIERE CORRECCIONES**

La app está técnicamente muy cerca de poder publicarse (SDK, versionado, EAS, políticas legales y borrado de cuenta ya existen), pero se detectaron **3 problemas críticos de seguridad en las reglas de Firestore** que permiten a cualquier usuario autenticado, usando el SDK de Firestore directamente (sin pasar por la UI de la app), auto-otorgarse un plan pago, escalar a rol admin/organizador aprobado, y leer o alterar datos de otros usuarios. Ninguno de estos 3 puntos bloquea técnicamente la revisión automática de Google Play (Google no audita tus reglas de Firestore), pero representan un riesgo grave para el negocio (bypass de pagos) y para la privacidad de los usuarios, por lo que se recomienda tratarlos como bloqueantes internos antes de la publicación pública.

- 🔴 Críticos: **3** (los tres en `firestore.rules`)
- 🟠 Importantes: **7**
- 🟡 Recomendados: **6**
- 🟢 Correcto / sin cambios necesarios: **15+**

**Riesgos principales:**
1. Cualquier usuario podría desbloquearse el plan "Nexo Premium" gratis escribiendo directamente en su propio documento de Firestore (no hay validación server-side de `plan`/`planStatus`).
2. Cualquier usuario autenticado puede leer el email y teléfono de cualquier otro usuario, y leer/escribir/borrar las reservas de turnos de cualquier otro usuario o complejo.
3. La eliminación de cuenta es parcial: borra Auth + perfil + foto, pero deja rastros en conversaciones, invitaciones, favoritos, bloqueos y reportes.
4. Crashlytics está instalado pero nunca se invoca — no vas a tener visibilidad de los crashes de JavaScript una vez publicada la app.

Nada de esto impide subir el AAB a Google Play Console hoy mismo; son puntos que conviene resolver antes o inmediatamente después del lanzamiento.

---

## 1-7. CONFIGURACIÓN, APPLICATION ID, TARGET SDK, VERSIONADO, EAS, FIRMA

| Punto | Hallazgo |
|---|---|
| **Application ID** | `com.padelnexo.app` — consistente en `app.json` (`android.package`), `google-services.json` (`package_name`) e `ios.bundleIdentifier`. 🟢 |
| **Nombre app** | "PadelNexo" (`app.json` → `expo.name`). 🟢 |
| **compileSdkVersion / targetSdkVersion** | `36` explícito vía plugin `expo-build-properties` (`app.json:114-119`). Cumple el requisito de Google Play de agosto 2026 (Android 16 / API 36). No hay carpeta `android/` nativa que pueda pisar este valor (proyecto managed). 🟢 |
| **minSdkVersion** | No se sobreescribe — usa el default de Expo SDK 54 / RN 0.81 (típicamente API 24). No representa riesgo de incompatibilidad conocido. 🟢 |
| **version / versionCode** | `version: "1.0.0"`. `versionCode` gestionado por EAS (`appVersionSource: "remote"` en `eas.json`). Los builds `development`/`preview` hechos hasta ahora tienen `versionCode: 1`. Nunca se corrió el perfil `production`. |
| **runtimeVersion** | `policy: "appVersion"` — correcto para usar con `expo-updates` y EAS Update. 🟢 |
| **EAS perfiles** | `development` (apk, interno), `preview` (apk, interno), `production` (**app-bundle**, correcto para Play). Comando para generar el AAB cuando decidan hacerlo: `eas build --platform android --profile production`. No se ejecutó en esta auditoría. |
| **Firma / keystore** | La cuenta EAS (`waltwr`) está logueada. No se encontró ningún `.keystore`/`.jks` local (normal, EAS gestiona credenciales en la nube). No se pudo confirmar por CLI si ya existe un keystore de `production` registrado en EAS porque `eas credentials` requiere modo interactivo. **NO VERIFICABLE DESDE EL PROYECTO — REQUIERE COMPROBACIÓN MANUAL** (`eas credentials --platform android`, elegir perfil `production`). Si no existe, EAS lo genera automáticamente en el primer build de producción. |

---

## 8. FIREBASE AUTHENTICATION

Implementado en `src/services/authService.js` + `src/context/AuthContext.js`.

- Email/password: `registerUser`, `loginUser` ✅
- Google Sign-In: `loginWithGoogleIdToken` (`@react-native-google-signin/google-signin`) ✅
- Teléfono: no implementado (no se encontró `signInWithPhoneNumber` ni similar). 🟢 (no es requisito, solo informativo)
- Recuperación de contraseña: `resetPassword` vía Cloud Function propia (`sendPasswordReset`) en vez del flujo nativo de Firebase — funcional, con manejo de error "email_service_not_configured". 🟢
- Logout: `logoutUser` ✅
- Persistencia de sesión: `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })` — persistencia correcta en RN. 🟢
- Reautenticación antes de eliminar cuenta: implementada (`reauthenticateWithGoogleIdToken`), maneja `auth/requires-recent-login`. 🟢
- Verificación de email: `resendVerificationEmail` existe. No se pudo determinar si el registro **exige** verificación antes de dejar usar la app, o si es opcional. **NO VERIFICABLE COMPLETO — REQUIERE COMPROBACIÓN MANUAL** (probar el flujo real).
- Manejo de errores: centralizado en `firebaseErrors.js`, mensajes en español, no expone códigos internos al usuario. 🟢

No se detectaron contraseñas ni tokens hardcodeados en el código de autenticación.

---

## 9-10. FIRESTORE Y SUS REGLAS DE SEGURIDAD

### Colecciones detectadas realmente en uso (no inventadas)

`users`, `leagues`, `tournaments` (+ subcolecciones `registrations`, `groups`, `matches`, `notifications`), `turnosConfigs`, `turnoReservations`, `leagueRegistrationRequests`, `complexRequests`, `organizerRequests`, `conversations` (+ subcolección `messages`), `invitations`, `leagueFavorites`, `userBlocks`, `reports`, `locations`.

No es "Test Mode" (no hay `allow read, write: if true`), las reglas están presentes en `firestore.rules` en la raíz del repo. Pero se detectaron problemas serios de permisos demasiado amplios:

### 🔴 CRÍTICO 1 — Escritura sin restricción de campos en `/users/{userId}`

```
match /users/{userId} {
  allow read: if isAuth();
  allow write: if isUser(userId);
}
```

`isUser(userId)` solo verifica que sea el dueño del documento, pero permite escribir **cualquier campo**, incluidos los que controlan privilegios y monetización:

- `role` y `adminStatus` → `src/config/admin.js` (`canAccessAdminPanel`) da acceso de administrador si `role === "admin"` **o** `adminStatus === "active"`. Un usuario podría escribir eso en su propio documento y desbloquear el panel admin en el cliente.
- `organizerStatus` → puede pasarse directamente a `"approved"` sin pasar por la aprobación real.
- `plan` / `planStatus` → **`src/services/planService.js`** (`getUserPlanInfo`, `checkCanCreateLeague`, `checkCanCreateTournament`) confía ciegamente en estos campos leídos del documento del propio usuario para decidir si puede crear ligas/torneos ilimitados (plan "premium") o acceder a turnos. No existe ninguna Cloud Function en `functions/` que escriba `plan`/`planStatus` — todo indica que hoy se activa manualmente o desde la web tras el pago, pero **nada impide que el usuario lo escriba él mismo desde el cliente y obtenga el plan Premium gratis para siempre**.
- `blockStatus` → un usuario bloqueado por un admin podría desbloquearse a sí mismo.

**Impacto:** bypass de pagos (revenue directo), escalación de privilegios a admin/organizador.
**Solución sugerida (no implementada):** restringir con `request.resource.data.diff(resource.data).affectedKeys()` para que un usuario no pueda modificar `role`, `adminStatus`, `organizerStatus`, `plan`, `planStatus`, `blockStatus`; esos campos deberían escribirse solo desde Cloud Functions con Admin SDK (que ignora las reglas de Firestore).

### 🔴 CRÍTICO 2 — `turnoReservations` y `turnosConfigs` sin dueño

```
match /turnoReservations/{reservationId} { allow read, write: if isAuth(); }
match /turnosConfigs/{configId}          { allow read: if isAuth(); allow write: if isAuth(); }
```

Cualquier usuario autenticado (no solo el organizador dueño del complejo, no solo el jugador dueño de la reserva) puede leer, modificar o **borrar** cualquier reserva de cancha de cualquier otro usuario, y modificar la configuración de canchas/horarios de cualquier complejo.
**Impacto:** un usuario malicioso podría cancelar/alterar reservas ajenas o romper la grilla de turnos de un complejo entero.

### 🔴 CRÍTICO 3 — Lectura abierta de perfiles completos

```
match /users/{userId} { allow read: if isAuth(); ... }
```

Cualquier usuario autenticado puede leer el documento completo de cualquier otro usuario directamente vía SDK (no solo lo que la UI de la app decide mostrar). Según `adminService.js`, ese documento incluye **email**, **teléfono**, localidad/ubicación, y datos de plan. Esto expone PII de todos los usuarios a cualquier cuenta autenticada, más allá de lo que las pantallas de la app efectivamente muestran.

### Otros hallazgos en `firestore.rules` (menor severidad, 🟡)

- `userBlocks`, `complexRequests`, `organizerRequests`: `allow create: if isAuth()` sin validar que el campo `userId`/`blockerId` del documento creado coincida con `request.auth.uid` → un usuario podría, en teoría, crear un registro suplantando a otro usuario.
- `reports`: solo el propio `reporterId` puede leer/editar/borrar su reporte — correcto para el usuario, pero implica que la moderación de reportes se hace fuera del cliente (consola de Firebase o backend), lo cual está bien, solo dejarlo anotado.

**Todo el resto de las reglas** (`leagues`, `tournaments` y subcolecciones, `conversations`/`messages` con función `puedeUsarChat()` y restricción por edad vía `chatHabilitado`, `invitations`, `leagueFavorites`, `leagueRegistrationRequests`) están razonablemente bien planteadas: validan pertenencia (`organizerId`/`createdBy`/`userId`) antes de permitir `update`/`delete`. 🟢

---

## 11. FIREBASE STORAGE

Se usa desde `services/firebaseStorage.js` y `src/services/userService.js` (fotos de perfil en `profileImages/{uid}`), y probablemente comprobantes de pago (referenciado en los permisos de cámara/galería de `app.json`).

**No se encontró ningún archivo `storage.rules` en el repositorio**, y `firebase.json` no declara un target de reglas de Storage (`"storage": { "rules": "storage.rules" }` está ausente — solo hay `firestore` y `hosting`). Esto significa que las reglas de Storage **no están versionadas en este proyecto** y deben estar configuradas directamente en la consola de Firebase.

**NO VERIFICABLE DESDE EL PROYECTO — REQUIERE COMPROBACIÓN MANUAL**: entrar a Firebase Console → Storage → Rules y confirmar que no está en modo de prueba abierto (`allow read, write: if true`) ni permite que un usuario borre/sobrescriba archivos de otro usuario (p. ej. que la escritura en `profileImages/{uid}` esté condicionada a `request.auth.uid == uid`).

---

## 12. VARIABLES DE ENTORNO Y SECRETOS

- `.env` (raíz) y `functions/.env` están correctamente listados en sus respectivos `.gitignore` y **no están trackeados en git** (verificado con `git ls-files`). Solo se trackean `.env.example` y `functions/.env.example`. 🟢
- `.env` solo contiene la Mercado Pago **public key** (no es secreta por diseño). 🟢
- El **access token** de Mercado Pago (`MERCADO_PAGO_ACCESS_TOKEN`) se usa exclusivamente en `functions/` (server-side), nunca en el cliente. 🟢
- `services/firebaseConfig.js` tiene el `firebaseConfig` (apiKey, projectId, etc.) **hardcodeado** en el código en vez de leerlo de variables de entorno, aunque `.env.example` sugiere que debería venir de `EXPO_PUBLIC_FIREBASE_*`. Esto **no es un riesgo de seguridad** (las apiKey de Firebase para clientes son públicas por diseño, la seguridad real la dan las reglas de Firestore/Storage), pero el `.env.example` está desactualizado/es engañoso. 🟡
- No se detectaron API keys, tokens ni contraseñas hardcodeadas fuera de lo anterior en `src/`.

---

## 13. MERCADO PAGO

- Cliente (`src/config/mercadoPago.js`, `src/services/mercadoPago*Service.js`): solo maneja la **public key** y URLs de Cloud Functions (checkout, sync, OAuth) leídas desde `app.json → extra.mercadoPago`. No hay lógica de cobro ni validación de pago en el cliente. 🟢
- Backend (`functions/mercadoPagoCheckoutPro.js`, `mercadoPagoShared.js`, `mercadoPagoOAuth.js`): usa el SDK oficial de Mercado Pago con el `accessToken` desde variables de entorno de Functions. 🟢
- Webhook: valida firma HMAC (`x-signature`) contra `MERCADO_PAGO_WEBHOOK_SECRET` **solo si esa variable está configurada**; si no está seteada, el webhook sigue aceptando notificaciones **sin validar firma** (con un `logger.warn`). 🟠 **NO VERIFICABLE si `MERCADO_PAGO_WEBHOOK_SECRET` está cargada en el entorno de producción de Cloud Functions** — si no lo está, alguien podría enviar notificaciones de pago falsas al endpoint.
- Productos/servicios cobrados: (1) inscripciones a torneos, (2) inscripciones a ligas, (3) reservas de turnos de cancha — todos son **servicios/eventos reales**, no contenido digital dentro de la app. (2) Los "planes" de organizador (`Nexo Simple/Plus/Premium`) se promocionan vía un banner que **redirige a la web** (`padelnexo.com.ar/planes`), no hay checkout de planes dentro de la app móvil.

**Riesgo de política de Google Play Billing:** dado que el pago de los planes de organizador ocurre completamente fuera de la app (en la web), el riesgo de que Google exija Play Billing para esa función es bajo, pero es una zona gris de política que conviene que revisen ustedes mismos en la Play Console al declarar "funciones financieras", ya que Google puede pedir aclaraciones. Los pagos de torneos/ligas/turnos (servicios reales, no digitales) generalmente **no** requieren Play Billing. Esta es una evaluación de riesgo, no una garantía de aprobación — **NO VERIFICABLE / decisión final de Google**.

---

## 14. ELIMINACIÓN DE CUENTA

**Existe y es accesible**: botón "Eliminar cuenta" en `src/components/ProfileModal.js:1221`, implementado en `AuthContext.deleteAccount` (`src/context/AuthContext.js:421-459`) llamando a `authService.deleteCurrentUserAccount`.

Qué borra realmente (`src/services/userService.js:324-357`, función `deleteUserProfileData`):
- ✅ Cuenta de Firebase Authentication (`deleteUser`)
- ✅ Foto de perfil en Storage (`profileImages/{uid}`)
- ✅ Documento `organizerRequests/{uid}`
- ✅ Documento `users/{uid}`
- ✅ Sesión de Google Sign-In (`clearGoogleSignInSession`)

Qué **NO** borra (queda huérfano con el `uid` del usuario eliminado):
- ❌ Mensajes/conversaciones en `conversations`/`messages` donde participó
- ❌ `invitations` enviadas/recibidas
- ❌ `leagueFavorites`
- ❌ `userBlocks` (bloqueos que hizo o que le hicieron)
- ❌ `reports` que presentó
- ❌ `turnoReservations`, inscripciones a `leagues`/`tournaments` (historial de reservas/participación)

**🟠 IMPORTANTE**: no es necesariamente un bloqueante para Google Play (el borrado de la cuenta de Auth + perfil ya es lo mínimo exigido), pero **la política de privacidad y el formulario de Data Safety deben reflejar con precisión qué datos se retienen y por qué** (p. ej. "conservamos el historial de reservas y mensajes de forma anonimizada para integridad del servicio"), en vez de dar a entender un borrado total.

---

## 15-17. POLÍTICA DE PRIVACIDAD, TÉRMINOS Y SOPORTE

- **Política de Privacidad**: enlazada en `RegisterScreen.js:469` → `https://www.padelnexo.com.ar/politica-privacidad`. Existe también en el repo de la web (`padelnexo-web/app/privacidad`). 🟢
- **Términos y Condiciones**: enlazados en `RegisterScreen.js:462` → `https://www.padelnexo.com.ar/terminos-condiciones`. 🟢
- Ambos aparecen como texto/links **debajo** del botón "Registrarme", no como un checkbox que el usuario deba tickear activamente antes de registrarse. 🟡 Recomendado (no obligatorio) agregar un checkbox explícito de aceptación para dejar constancia de consentimiento más clara.
- No se encontró un enlace a los Términos/Privacidad en pantallas de configuración/perfil dentro de la app (solo aparecen durante el registro). 🟡
- **Soporte**: no se encontró ningún email/canal de soporte visible **dentro de la app** (ProfileModal no tiene sección de ayuda/contacto). Sí existe `soporte.padelnexo@gmail.com` publicado en la política de privacidad de la web (`padelnexo-web/app/privacidad/page.tsx:159-160,196`), que además sirve para el campo de contacto obligatorio de Play Console. 🟠 Recomendado agregarlo también dentro de la app (p. ej. en Perfil/Ajustes).

---

## 18-20. PERMISOS ANDROID Y UBICACIÓN

Permisos declarados en `app.json → android.permissions`: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`. Además, los plugins `expo-location` e `image-picker` inyectan sus propios permisos (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) automáticamente en el manifest generado — no es necesario declararlos manualmente en el array.

| Permiso | Se declara | Se usa en código | Motivo | Riesgo de rechazo |
|---|---|---|---|---|
| CAMERA | `app.json` + plugin `expo-image-picker` | `ProfileModal.js`, `CreateTournamentScreen.js`, pantallas de pagos (comprobantes) | Foto de perfil / comprobantes de pago | Bajo — descripción de uso presente en `infoPlist`/plugin |
| READ_MEDIA_IMAGES / VIDEO | `app.json` + plugin | mismos flujos de selección de imagen | Subir foto de perfil / comprobante | Bajo |
| ACCESS_FINE/COARSE_LOCATION | Inyectado por plugin `expo-location`, con `locationWhenInUsePermission` en español | `src/services/locationService.js` (`requestForegroundPermissionsAsync`, precisión `Balanced`) | Buscar jugadores/complejos/turnos cercanos | Bajo — solo foreground, aproximada, bajo demanda |
| INTERNET / ACCESS_NETWORK_STATE | `app.json` | uso general de la app | Conectividad | N/A |

No se encontró uso de: micrófono, contactos, teléfono (llamadas), almacenamiento genérico fuera de lo anterior. La app **no** solicita ubicación en segundo plano (`ACCESS_BACKGROUND_LOCATION`), lo cual evita el trámite adicional que Google exige para ese permiso. 🟢

**Cámara/Galería**: se usa `expo-image-picker`; no se revisó a fondo el manejo de "permiso denegado" en cada pantalla individual — **NO VERIFICABLE COMPLETO, requiere prueba manual** en dispositivo con permisos rechazados.

---

## 21. NOTIFICACIONES

`expo-notifications` está instalado y declarado como plugin en `app.json`, pero **no se encontró ningún uso real de la API** (`Notifications.requestPermissionsAsync`, `getExpoPushTokenAsync`, listeners) en `src/`. `src/services/pushNotificationsService.js` es explícitamente un stub: `registerForPushNotificationsAsync` solo hace `devLog(...)` y devuelve `null` siempre (comentario en el código: "Push notifications disponibles solo en builds nativos (EAS Build)" — pero incluso en builds nativos, la función no llama a ninguna API de Expo Notifications, solo retorna `null` incondicionalmente).

Lo que sí existe y funciona es un sistema de **notificaciones internas basadas en Firestore** (subcolección `tournaments/{id}/notifications`, `turnosNotificationsService.js`), no notificaciones push del sistema operativo.

🟡 Recomendado: si el objetivo es tener push notifications reales, falta implementar el registro de push token y el listener; si no es el objetivo actual, se podría quitar el plugin `expo-notifications` de `app.json` para no declarar una capacidad que no se usa (no es obligatorio, solo prolijidad).

---

## 22-23. CRASHLYTICS Y MANEJO DE ERRORES

- `@react-native-firebase/crashlytics` está instalado y el plugin está en `app.json`. Se importa en `App.js:2`.
- **Nunca se invoca** (`grep` de `crashlytics(` en todo el repo: 0 resultados fuera del import). No hay `crashlytics().recordError()`, `crashlytics().log()`, ni `setCrashlyticsCollectionEnabled()`.
- Existe un `RootErrorBoundary` (`App.js:490-548`) que captura errores de render de React, pero solo hace `devLog(...)` (que no hace nada en producción por estar gateado con `__DEV__`) y muestra una pantalla de error al usuario — **no reporta el error a Crashlytics**.
- 🟠 **Importante**: Crashlytics probablemente capture crashes nativos automáticamente (por estar linkeado), pero **no vas a tener visibilidad de excepciones de JavaScript no controladas** una vez publicada la app, que es el tipo de error más común en apps React Native. Se recomienda agregar `crashlytics().recordError(error)` en `RootErrorBoundary.componentDidCatch` y un handler global (`ErrorUtils.setGlobalHandler` o `setJSExceptionHandler`) antes del lanzamiento.
- No se revisó cada `try/catch` individualmente (son cientos), pero el patrón observado en los servicios revisados (`authService`, `userService`, `mercadoPago*`) es consistente: casi todo está envuelto en `try/catch` con mensajes de error en español para el usuario. 🟢 Patrón razonable, sin bloqueos evidentes.

---

## 24. OFFLINE / CONEXIÓN

No se hizo una prueba en vivo (auditoría estática). Se observó que Firestore se inicializa con `experimentalForceLongPolling: true` (mitiga problemas de red en algunos entornos Android) y que gran parte de los servicios devuelven errores manejados ("No pudimos... verificá tu conexión") en vez de dejar que la promesa explote sin capturar. **NO VERIFICABLE completamente sin correr la app** — recomendado probar manualmente: modo avión durante login, durante un pago, y con carga de imágenes.

---

## 25. AUTENTICACIÓN Y SEGURIDAD (LOGS/TOKENS)

- Un solo `console.log` real en todo `src/`, y es la propia definición de `devLog` (`src/utils/devLog.js`), que queda **desactivado en producción** (`__DEV__` es `false` en release builds). Todo el resto del código usa `devLog(...)` en vez de `console.log`. 🟢 Muy buena práctica, no se filtran logs a producción.
- No se encontraron contraseñas ni tokens guardados manualmente en AsyncStorage fuera de lo que gestionan internamente Firebase Auth y Google Sign-In.
- No se encontraron URLs de desarrollo, `localhost`, IPs locales (`127.0.0.1`, `10.0.2.2`, `192.168.x`) en `src/`. 🟢

---

## 26-28. CONTENIDO GENERADO POR USUARIOS, MENSAJERÍA Y PERFILES

- **Bloqueo de usuarios**: implementado (`src/services/blockingService.js`, colección `userBlocks`), con `getConversationBlockStatus` para chequear bloqueo en ambos sentidos antes de permitir interacción. 🟢
- **Reportes**: implementado (`src/services/reportsService.js`, colección `reports`, con `targetType`/`targetId`/`description`). 🟢 La revisión/moderación de esos reportes ocurre fuera del cliente (solo el propio reporter puede leer su reporte vía reglas), asumiendo que el equipo la hace desde la consola de Firebase — **NO VERIFICABLE si existe un proceso de moderación activo del lado humano**, eso es operativo, no de código.
- **Mensajería**: reglas de Firestore restringen lectura/escritura a los `participants` de la conversación, y exigen `chatHabilitado == true` o rol `organizer` (comentario en las reglas: "solo participantes mayores de 14, o usuarios con rol organizador"), lo cual sugiere una restricción de edad para chat. 🟢 Buen diseño, ver también el Crítico 3 sobre exposición de perfiles (el chat en sí está bien acotado).
- **Perfiles de usuario**: el documento `users/{uid}` contiene, según `adminService.js`, nombre, email, teléfono, foto, ubicación (ciudad/provincia), categoría/sexo/mano hábil, plan, etc. La UI probablemente no muestra el email/teléfono a otros jugadores, pero como se detalló en el Crítico 3, **cualquier usuario autenticado puede leerlo igual directamente por Firestore**, independientemente de lo que la pantalla de perfil decida mostrar.

---

## 29-30. DATOS DE PAGOS Y PROPUESTA DE DATA SAFETY

PadelNexo **no almacena** datos de tarjetas ni datos bancarios — eso lo maneja Mercado Pago directamente (Checkout Pro/OAuth). Lo que sí persiste en Firestore son **identificadores y estados de pago** (`paymentId`, `externalReference`, `status` aprobado/rechazado/pendiente) asociados a reservas/inscripciones.

### Propuesta de tabla para Google Play → App content → Data safety

*(Propuesta basada en lo que el código realmente hace. Deben completarla ustedes en Play Console — esto no se envía automáticamente.)*

| Dato | Se recopila | Se comparte | Finalidad | Obligatorio/posible |
|---|---|---|---|---|
| Nombre | Sí | No | Funcionalidad de la app (perfil, ligas, torneos) | Obligatorio |
| Email | Sí (Auth + perfil) | No (excepto con Mercado Pago para procesar pago, y proveedor de email transaccional) | Cuenta de usuario, comunicaciones | Obligatorio |
| Teléfono | Sí (opcional en perfil) | No | Contacto entre organizador/jugador (WhatsApp manual, no automatizado) | Posible/opcional |
| Ubicación (aproximada) | Sí, solo bajo demanda y en primer plano | No | Buscar jugadores/complejos/turnos cercanos | Posible/opcional |
| Fotos | Sí (foto de perfil, comprobantes de pago) | No | Personalización de perfil, verificación de pagos | Posible/opcional |
| Mensajes | Sí (chat interno) | No | Comunicación entre usuarios habilitados | Posible/opcional |
| Actividad en la app (favoritos, inscripciones, reservas) | Sí | No | Funcionalidad principal | Obligatorio |
| Información de pagos (estado/ID, no tarjeta) | Sí | Sí, con Mercado Pago (procesador de pago) | Procesar inscripciones/reservas | Obligatorio para esas funciones |
| Identificadores (uid, push token si se implementa) | Sí | No | Autenticación, notificaciones | Obligatorio |
| Diagnósticos / crash data | Parcial — Crashlytics instalado pero no invocado activamente (ver sección 22) | Con Firebase/Google | Estabilidad de la app | Posible |

**Nota importante**: dado que Crashlytics está instalado (aunque subutilizado), Google Play probablemente exige declarar "datos de diagnóstico" igual, porque el SDK está presente en el binario aunque no se llame activamente. **NO VERIFICABLE la posición exacta de Google al respecto** — se recomienda declararlo por las dudas.

---

## 31-32. CLASIFICACIÓN DE CONTENIDO Y RIESGOS DE POLÍTICA

Elementos que afectan el cuestionario de clasificación de contenido:
- Interacción entre usuarios (chat, invitaciones) → sí
- Contenido generado por usuarios (mensajes, fotos de perfil) → sí, moderado con bloqueo/reportes
- Deporte / competencia → sí (torneos, ligas)
- Transacciones con dinero real → sí (inscripciones, reservas de cancha)
- Ubicación → sí, aproximada y opcional
- No se detectó contenido para adultos, apuestas, ni alcohol/tabaco

Riesgos de política a revisar manualmente (evaluación de riesgo, **no un veredicto de Google**):
- Declarar correctamente "funciones financieras" por el manejo de pagos vía Mercado Pago.
- Confirmar que el flujo de planes de organizador (pago 100% en la web, fuera de la app) no dispara el requisito de Google Play Billing — recomendado documentarlo explícitamente al enviar la app a revisión, por si Google pide aclaración.
- Cuenta con eliminación de cuenta accesible in-app, lo cual cumple el requisito de Google de fines de 2023 de ofrecer borrado de cuenta (aunque sea parcial, ver sección 14).

---

## 33. WEB PADELNEXO

Se confirmaron referencias reales en el código a `https://www.padelnexo.com.ar`:
- `/funcionalidades` (banner en `HomeScreen.js:960`)
- `/terminos-condiciones` y `/politica-privacidad` (`RegisterScreen.js`)
- Cloud Functions apuntan a `southamerica-east1-padelnexo-7e4d5.cloudfunctions.net/...` (backend real, no de prueba)
- El banner de organizador enlaza a `/planes` en la web (confirmado por commits recientes y por `HomeScreen.js`)

No se navegó a esas URLs externas (fuera del alcance de esta auditoría estática), solo se confirmó que el código las referencia.

---

## 34. LOGOS / ICONOS / SPLASH

- `assets/icon.png`: 1024×1024 ✅
- `assets/adaptive-icon.png`: 1024×1024 ✅ (no se pudo verificar visualmente si el contenido respeta la "zona segura" circular/cuadrada que Android recorta — recomendado revisarlo a ojo)
- Splash (`assets/padelnexo-logo-full.png`): 1024×1024, `resizeMode: contain`, fondo `#F4F6F8` configurado correctamente en `app.json`
- No se detectaron problemas evidentes de configuración.

---

## 35-36. DEPENDENCIAS Y EXPO

- Expo SDK `~54.0.36`, React Native `0.81.5`, React `19.1.0` — combinación reciente y coherente entre sí (versiones alineadas al mismo SDK de Expo).
- `expo-build-properties`, `expo-notifications`, `expo-location`, `expo-image-picker`, `@react-native-firebase/*`, `@react-native-google-signin/google-signin` son plugins con configuración nativa — todos declarados correctamente en `app.json → plugins`. 🟢
- No se encontró `devDependencies` ni script de testing en `package.json` — no hay suite de tests automatizados. 🟡 Recomendado (no bloqueante).
- No se ejecutó `expo-doctor` ni `npm install` (respetando la restricción de no instalar/actualizar paquetes de esta auditoría) — por lo tanto **no se puede confirmar al 100% la ausencia de conflictos de peer dependencies**. **NO VERIFICABLE SIN EJECUTAR HERRAMIENTAS — REQUIERE COMPROBACIÓN MANUAL** (`npx expo-doctor`, fuera de esta auditoría).

---

## 37. PRODUCCIÓN VS DESARROLLO

- Sin `localhost`/IPs locales en `src/`. Sin `TODO`/`FIXME`/`XXX` en `src/`. Sin `console.log` activo en producción (gateado por `devLog`/`__DEV__`).
- Un caso interesante y **positivo**: `App.js` implementa un chequeo de versión mínima/sugerida contra un documento `appConfig/versionControl` en Firestore, mostrando un modal de "actualización requerida/sugerida" con link directo a la ficha de Play Store. Mecanismo ya preparado para post-lanzamiento. 🟢
- No se detectaron mocks ni datos falsos hardcodeados en los servicios revisados.

---

## 38. BASE DE DATOS DE LOCALIDADES

- Fuente estática: `data/locations.json` (bundle local de localidades argentinas), usado en varias pantallas (`LigasHubScreen`, `TorneosScreen`, `JugadoresScreen`, `SectionFilterBar`).
- Además, `LocationPicker.js` consulta una colección Firestore `locations` (probablemente para ubicaciones de complejos cargadas por organizadores, no localidades). Regla de Firestore para `locations` no está explícitamente definida en `firestore.rules` — al no haber un `match /locations/{id}` específico, por defecto **está denegada** (Firestore deniega todo lo que no matchea ninguna regla), lo cual podría estar **rompiendo esa función en producción** si de verdad se usa para lectura/escritura de usuarios normales. 🟠 **Importante verificar**: probar en la app real si el `LocationPicker` funciona correctamente o falla silenciosamente por falta de permisos en esa colección.

---

## 39. FUNCIONALIDADES PRINCIPALES

No se encontraron `TODO`/`FIXME` ni placeholders evidentes. Se confirmó código funcional (no solo UI vacía) para: jugadores (`playersService.js`), ligas (`leaguesService.js`), torneos (`tournamentsService.js`), turnos (`turnosService.js`), organizadores (`organizerService.js`, `organizerTasksService.js`), invitaciones (`invitationsService.js`), mensajes (`chatService.js`), disponibilidad (`availabilityService.js`, `tournamentAvailabilityService.js`), pagos (Mercado Pago), perfil (`userService.js`), planes (`planService.js`), admin (`adminService.js`). No se auditó cada pantalla en detalle línea por línea (son 100+ archivos) — esto es una revisión de existencia/coherencia de servicios, no un test funcional end-to-end. **NO VERIFICABLE al 100% sin probar cada flujo en un dispositivo real.**

---

# CHECKLIST FINAL

| Área | Estado | Prioridad | Problema | Acción recomendada |
|---|---|---|---|---|
| Android SDK (target/compile 36) | 🟢 | — | Ninguno | Ninguna |
| Application ID | 🟢 | — | Ninguno | Ninguna |
| Versionado | 🟡 | Baja | `versionCode` remoto, sin build de producción corrido todavía | Confirmar primer build de `production` |
| EAS | 🟢 | — | Perfil `production` correcto (AAB) | Ninguna |
| Firma / keystore | ⚪ No verificable | — | No se pudo confirmar por CLI no interactiva | `eas credentials --platform android` manualmente |
| Firebase Auth | 🟢 | — | Implementación sólida | Confirmar si se exige verificación de email |
| Firestore (colecciones) | 🟢 | — | Uso coherente, sin datos inventados | Ninguna |
| Firestore Rules | 🔴 | Crítica | Escritura libre en `users`, `turnoReservations`/`turnosConfigs` sin dueño, lectura abierta de PII | Reescribir reglas con validación de campos y de propietario |
| Storage | 🟡 | Media | Uso correcto en código | — |
| Storage Rules | ⚪ No verificable | Alta | No están en el repo | Revisar en consola de Firebase antes de publicar |
| Variables de entorno | 🟢 | — | `.env` correctamente ignorado, sin secretos expuestos | Actualizar `.env.example` (cosmético) |
| Mercado Pago | 🟠 | Media | Webhook con validación de firma opcional | Confirmar `MERCADO_PAGO_WEBHOOK_SECRET` seteada en producción |
| Eliminación de cuenta | 🟠 | Media | Borrado parcial (deja mensajes, invitaciones, reservas, bloqueos) | Documentar en política de privacidad o completar borrado |
| Política de privacidad | 🟢 | — | Existe y está enlazada | Ninguna |
| Términos | 🟡 | Baja | Sin checkbox explícito de aceptación | Agregar checkbox (recomendado, no obligatorio) |
| Soporte | 🟠 | Media | Sin canal visible dentro de la app | Agregar email de soporte en Perfil/Ajustes |
| Permisos | 🟢 | — | Declarados y usados coherentemente | Ninguna |
| Ubicación | 🟢 | — | Foreground, aproximada, bajo demanda | Ninguna |
| Cámara/Galería | 🟢 | — | Uso correcto | Probar manejo de permiso denegado |
| Notificaciones | 🟡 | Baja | Plugin instalado pero sin push real implementado | Implementar o quitar el plugin |
| Crashlytics | 🟠 | Media | Instalado pero nunca invocado | Conectar `recordError` en `RootErrorBoundary` + handler global |
| Data Safety | ⚪ Pendiente de completar | Alta | Formulario de Play Console no completado (obligatorio para publicar) | Completar con la tabla propuesta en sección 30 |
| Contenido generado | 🟢 | — | Bloqueo y reportes implementados | Confirmar proceso humano de moderación |
| Moderación | 🟢 | — | `blockingService`/`reportsService` funcionales | — |
| Dependencias | 🟢 | — | Versiones coherentes entre sí | Correr `expo-doctor` manualmente |
| Expo | 🟢 | — | SDK 54, compatible con API 36 | Ninguna |
| Producción (dev leftovers) | 🟢 | — | Sin localhost/TODO/console.log activo | Ninguna |
| Web | 🟢 | — | Referencias reales a padelnexo.com.ar | Ninguna |
| Plan de organizador (monetización) | 🔴 | Crítica | `plan`/`planStatus` escribibles por el cliente sin validación server-side | Mover activación de plan a Cloud Function + bloquear el campo en reglas |

---

# PLAN DE ACCIÓN

## 🔴 HACER ANTES DE GENERAR EL AAB DEFINITIVO

1. Corregir `firestore.rules`: impedir que un usuario modifique `role`, `adminStatus`, `organizerStatus`, `plan`, `planStatus`, `blockStatus` de su propio documento (esos campos solo deberían poder escribirse desde Cloud Functions con Admin SDK).
2. Corregir `firestore.rules` de `turnoReservations` y `turnosConfigs` para exigir que solo el dueño de la reserva o el organizador del complejo puedan leer/escribir/borrar.
3. Restringir la lectura de `users/{userId}` para que un usuario no pueda leer el documento completo (email/teléfono) de otro usuario — exponer solo un subconjunto público (por ejemplo, vía una colección/subcolección de "perfil público" separada, o listas de campos permitidos).
4. Revisar/crear reglas explícitas para la colección `locations` (hoy sin match → denegada por defecto, puede estar rompiendo `LocationPicker`).

## 🟠 HACER ANTES DE SUBIR A GOOGLE PLAY

5. Confirmar en Firebase Console que las Storage Rules no están en modo abierto y validan propietario.
6. Confirmar que `MERCADO_PAGO_WEBHOOK_SECRET` está configurada en el entorno de producción de Cloud Functions.
7. Agregar un canal de soporte visible dentro de la app (email `soporte.padelnexo@gmail.com` en Perfil/Ajustes).
8. Documentar con precisión en la política de privacidad qué datos NO se borran al eliminar la cuenta (mensajes, reservas, invitaciones, bloqueos, reportes).
9. Completar el formulario de Data Safety en Play Console (usar la tabla propuesta en la sección 30 como base).
10. Confirmar (`eas credentials --platform android`) el estado del keystore de producción y hacer backup una vez generado.

## 🟡 HACER ANTES DE LA PUBLICACIÓN DEFINITIVA (o primeras actualizaciones)

11. Conectar Crashlytics de verdad: `crashlytics().recordError(error)` en `RootErrorBoundary` + un handler global de excepciones no controladas.
12. Decidir si se implementa push real con `expo-notifications` o se retira el plugin.
13. Agregar checkbox explícito de aceptación de Términos/Privacidad en el registro.
14. Actualizar `.env.example` para que refleje la config real (o documentar por qué Firebase está hardcodeado).

## 🟢 PUEDE QUEDAR PARA DESPUÉS

15. Suite de tests automatizados.
16. Revisar visualmente la zona segura del adaptive icon.
17. Ajustar reglas menores de `userBlocks`/`complexRequests`/`organizerRequests` para validar que el campo de usuario coincida con `request.auth.uid` en el `create`.
