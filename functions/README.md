# Firebase Functions para Mercado Pago

Esta carpeta deja preparado el backend de `Checkout Pro` para cobrar `turnos`
sin guardar secretos dentro de la app.

## Etapa actual

La integracion activa de PadelNexo usa solamente:

- Frontend: `EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY`
- Backend: `MERCADO_PAGO_ACCESS_TOKEN`

No se requiere `Client Secret` para crear preferencias de `Checkout Pro` en
modo prueba.

## Endpoints activos para Checkout Pro

- `mercadoPagoCreateTurnoPreference`
  - Crea una preferencia de Checkout Pro para una reserva de turno.
- `mercadoPagoWebhook`
  - Recibe la notificacion de Mercado Pago y actualiza
    `turnoReservations/{reservationId}` en Firestore.

## Variables de entorno del backend

Copia `functions/.env.example` a `functions/.env` y completa:

- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_URL`
- `MERCADO_PAGO_STATEMENT_DESCRIPTOR`

Variable recomendada para validar la autenticidad del webhook en produccion o
al usar la simulacion desde "Tus integraciones":

- `MERCADO_PAGO_WEBHOOK_SECRET`

Variables opcionales para una etapa futura con OAuth por organizador:

- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_OAUTH_REDIRECT_URL`

## Configuracion del frontend

En el entorno de Expo se define:

- `EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY`

Y en `app.json` se define:

- `expo.extra.mercadoPago.turnosCheckoutUrl`

## Flujo actual

1. La app crea o identifica la reserva de turno.
2. La app llama a `mercadoPagoCreateTurnoPreference`.
3. El backend devuelve `initPoint`.
4. La app abre Checkout Pro.
5. Mercado Pago llama a `mercadoPagoWebhook`.
6. El webhook actualiza la reserva en Firestore.

## Webhooks y validacion de firma

- Si `MERCADO_PAGO_WEBHOOK_SECRET` no esta cargada, el webhook sigue aceptando
  notificaciones y deja un log avisando que la firma no fue validada.
- Si `MERCADO_PAGO_WEBHOOK_SECRET` esta cargada, el webhook exige una firma
  valida en `x-signature` y responde `401` si no coincide.
- Para pruebas reales de recepcion en entorno de testing, Mercado Pago indica
  usar la opcion **Simular** desde **Tus integraciones**, ya que los pagos de
  prueba no envian notificaciones reales.

## Logs de diagnostico esperados

- Access Token cargado correctamente
- Public Key cargada correctamente
- Preferencia creada correctamente
- URL de Checkout Pro generada correctamente

## Despliegue

1. Instalar dependencias dentro de `functions`
2. Desplegar:

```bash
firebase deploy --only functions
```

## OAuth futuro

El codigo OAuth del organizador queda desacoplado de Checkout Pro para una
futura etapa tipo marketplace por organizador. Esa parte no es necesaria para
las pruebas actuales de cobro con credenciales de prueba.
