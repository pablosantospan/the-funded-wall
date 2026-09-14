# The Funded Wall

MVP funcional: landing con el muro, checkout de Stripe, subida de captura tras el pago, y panel de admin para aprobar huecos.

## 1. Instalar

```
npm install
```

## 2. Configurar variables de entorno

```
cp .env.example .env
```

Y rellena `.env` con:

- `STRIPE_SECRET_KEY`: tu clave secreta de Stripe (empieza en modo test, `sk_test_...`), la sacas de https://dashboard.stripe.com/apikeys
- `STRIPE_WEBHOOK_SECRET`: lo consigues al configurar el webhook (paso 4)
- `ADMIN_USER` / `ADMIN_PASSWORD`: lo que quieras, para entrar en `/admin`
- `SITE_URL`: en local, `http://localhost:3000`. En producción, tu dominio real.

## 3. Arrancar en local

```
npm start
```

Verás el muro en `http://localhost:3000`.

## 4. Probar el pago en local (Stripe CLI)

Stripe necesita enviarte un webhook cuando alguien paga, y tu máquina local no es accesible desde fuera. Para probarlo en local:

1. Instala la [Stripe CLI](https://stripe.com/docs/stripe-cli).
2. Ejecuta `stripe login`.
3. Ejecuta `stripe listen --forward-to localhost:3000/webhook`.
4. Te dará un `whsec_...` — cópialo en `STRIPE_WEBHOOK_SECRET` de tu `.env` y reinicia el servidor.
5. Usa una [tarjeta de prueba](https://stripe.com/docs/testing) como `4242 4242 4242 4242` para pagar sin dinero real.

## 5. Desplegar de verdad

Esto necesita un servidor que esté siempre encendido (no vale hosting estático tipo GitHub Pages, porque hay backend con Stripe). Opciones sencillas y baratas:

- **Railway** o **Render**: conectas el repo de GitHub, defines las variables de entorno en su panel, y listo. Es la opción más simple para esto.
- En producción, configura el webhook real en el [dashboard de Stripe](https://dashboard.stripe.com/webhooks) apuntando a `https://tudominio.com/webhook`, evento `checkout.session.completed`.
- Cuando quieras cobrar de verdad, cambia tus claves de Stripe de modo test (`sk_test_...`) a modo live (`sk_live_...`) — Stripe requiere que actives tu cuenta con datos fiscales reales para esto.

## 6. Cómo funciona el flujo

1. El usuario hace clic en un hueco vacío del muro → modal → paga en Stripe (introduce su alias en el propio checkout).
2. Al completarse el pago, el webhook reserva el siguiente hueco libre a su nombre.
3. Stripe le redirige a `/claim.html`, donde sube su captura y rellena prop firm / payout / link de X.
4. Tú revisas en `/admin` (usuario y contraseña de tu `.env`) y apruebas o rechazas.
5. Al aprobar, el hueco pasa a "confirmado" y aparece público en el muro.
6. Si alguien paga y no sube nada en 48h, su hueco se confirma solo con el alias, sin más preguntas (esto ya está automatizado, se revisa cada vez que alguien carga el muro).

## Notas

- Los datos se guardan en `data/slots.json` — para el volumen inicial es suficiente. Si esto crece mucho, habría que migrar a una base de datos real.
- Las capturas se guardan en `uploads/` sin procesar. Antes de production real a gran escala, conviene moverlas a algo como S3/Cloudinary en vez del disco del propio servidor.
- El precio sube automáticamente por tramos según cuántos huecos hay ocupados (reservados + confirmados) — lo tienes configurable en `PRICE_TIERS` dentro de `server.js`.
