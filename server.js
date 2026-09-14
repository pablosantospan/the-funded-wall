require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');
const app = express();

const DATA_FILE = path.join(__dirname, 'data', 'slots.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TOTAL_SLOTS = 500;
const AUTO_CONFIRM_HOURS = 48;

// Tramos de precio: hasta cuántos huecos VENDIDOS (reservados+confirmados)
// entran a ese precio. El primer tramo cuyo "upTo" no se ha alcanzado manda.
const PRICE_TIERS = [
  { upTo: 50, price: 1900, label: '$19' },
  { upTo: 150, price: 2900, label: '$29' },
  { upTo: 300, price: 4900, label: '$49' },
  { upTo: 500, price: 9900, label: '$99' }
];
const TOP_SLOT_PRICE = { price: 29900, label: '$299' };

// ---------- almacenamiento simple en JSON ----------
// Para el volumen que vamos a tener al principio (decenas/cientos de huecos,
// un solo admin), un archivo JSON con escritura síncrona es más que suficiente.
// Si esto despega en serio, se migra a una base de datos real.

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.slots || data.slots.length === 0) {
    data.slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
      id: i + 1,
      status: 'empty', // empty | reserved | confirmed
      alias: null,
      propFirm: null,
      payoutRange: null,
      xLink: null,
      screenshotFile: null,
      avatarFile: null,
      stripeSessionId: null,
      reservedAt: null,
      submittedAt: null
    }));
    saveData(data);
  }
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function occupiedCount(data) {
  return data.slots.filter(s => s.status !== 'empty').length;
}

function currentTier(data) {
  const sold = occupiedCount(data);
  return PRICE_TIERS.find(t => sold < t.upTo) || PRICE_TIERS[PRICE_TIERS.length - 1];
}

function nextFreeSlot(data) {
  return data.slots.find(s => s.status === 'empty');
}

// Confirma automáticamente huecos reservados que llevan más de 48h sin
// captura subida — con el alias que ya tenemos de Stripe, sin más preguntas.
function autoConfirmStale(data) {
  const now = Date.now();
  let changed = false;
  for (const s of data.slots) {
    if (s.status === 'reserved' && !s.submittedAt && s.reservedAt) {
      const hoursSince = (now - new Date(s.reservedAt).getTime()) / 36e5;
      if (hoursSince > AUTO_CONFIRM_HOURS) {
        s.status = 'confirmed';
        changed = true;
      }
    }
  }
  if (data.topSlot.status === 'reserved' && !data.topSlot.submittedAt && data.topSlot.reservedAt) {
    const hoursSince = (now - new Date(data.topSlot.reservedAt).getTime()) / 36e5;
    if (hoursSince > AUTO_CONFIRM_HOURS) {
      data.topSlot.status = 'confirmed';
      changed = true;
    }
  }
  if (changed) saveData(data);
}

// ---------- middleware ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// El webhook de Stripe necesita el body RAW (sin parsear), así que se declara
// antes de express.json() y solo para esa ruta.
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const data = loadData();
    const alias = session.custom_fields?.find(f => f.key === 'alias')?.text?.value || 'anon';
    const isTop = session.metadata?.type === 'top';

    if (isTop && data.topSlot.status === 'empty') {
      data.topSlot.status = 'reserved';
      data.topSlot.alias = alias;
      data.topSlot.stripeSessionId = session.id;
      data.topSlot.reservedAt = new Date().toISOString();
    } else if (!isTop) {
      const slot = nextFreeSlot(data);
      if (slot) {
        slot.status = 'reserved';
        slot.alias = alias;
        slot.stripeSessionId = session.id;
        slot.reservedAt = new Date().toISOString();
      }
    }
    saveData(data);
  }

  res.json({ received: true });
});

app.use(express.json());

// ---------- API pública ----------

// Estado del muro: solo huecos confirmados se muestran con datos, el resto
// aparece vacío. Nunca exponemos datos de huecos "reserved" sin aprobar.
app.get('/api/wall', (req, res) => {
  const data = loadData();
  autoConfirmStale(data);
  const tier = currentTier(data);

  const publicSlots = data.slots.map(s => ({
    id: s.id,
    status: s.status === 'confirmed' ? 'confirmed' : (s.status === 'reserved' ? 'reserved' : 'empty'),
    alias: s.status === 'confirmed' ? s.alias : null,
    propFirm: s.status === 'confirmed' ? s.propFirm : null,
    payoutRange: s.status === 'confirmed' ? s.payoutRange : null,
    xLink: s.status === 'confirmed' ? s.xLink : null,
    avatarUrl: s.status === 'confirmed' && s.avatarFile ? `/uploads/${s.avatarFile}` : null
  }));

  const publicTop = {
    status: data.topSlot.status === 'confirmed' ? 'confirmed' : (data.topSlot.status === 'reserved' ? 'reserved' : 'empty'),
    alias: data.topSlot.status === 'confirmed' ? data.topSlot.alias : null,
    propFirm: data.topSlot.status === 'confirmed' ? data.topSlot.propFirm : null,
    payoutRange: data.topSlot.status === 'confirmed' ? data.topSlot.payoutRange : null,
    xLink: data.topSlot.status === 'confirmed' ? data.topSlot.xLink : null,
    avatarUrl: data.topSlot.status === 'confirmed' && data.topSlot.avatarFile ? `/uploads/${data.topSlot.avatarFile}` : null
  };

  res.json({
    total: TOTAL_SLOTS,
    occupied: occupiedCount(data),
    currentPrice: tier.label,
    topSlot: publicTop,
    topPrice: TOP_SLOT_PRICE.label,
    slots: publicSlots
  });
});

// Crea una sesión de Stripe Checkout. Pide el alias como campo obligatorio
// del propio checkout, así siempre tenemos un nombre aunque nunca suban captura.
app.post('/api/checkout', async (req, res) => {
  try {
    const { type } = req.body; // 'top' | 'standard'
    const data = loadData();

    if (type === 'top') {
      if (data.topSlot.status !== 'empty') {
        return res.status(409).json({ error: 'El hueco top ya está ocupado.' });
      }
    } else {
      if (!nextFreeSlot(data)) {
        return res.status(409).json({ error: 'No quedan huecos libres.' });
      }
    }

    const price = type === 'top' ? TOP_SLOT_PRICE.price : currentTier(data).price;
    const productName = type === 'top' ? 'The Funded Wall — top spot' : 'The Funded Wall — spot';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: price,
          product_data: { name: productName }
        },
        quantity: 1
      }],
      custom_fields: [{
        key: 'alias',
        label: { type: 'custom', custom: 'Tu alias/usuario para el muro' },
        type: 'text',
        text: { minimum_length: 2, maximum_length: 40 }
      }],
      metadata: { type: type === 'top' ? 'top' : 'standard' },
      success_url: `${process.env.SITE_URL}/claim.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la sesión de pago.' });
  }
});

// El frontend de éxito llama aquí para saber qué hueco le tocó y pintar el
// formulario de subida de captura.
app.get('/api/claim/:sessionId', (req, res) => {
  const data = loadData();
  const { sessionId } = req.params;

  if (data.topSlot.stripeSessionId === sessionId) {
    return res.json({ found: true, type: 'top', id: 'top', submitted: !!data.topSlot.submittedAt });
  }
  const slot = data.slots.find(s => s.stripeSessionId === sessionId);
  if (slot) {
    return res.json({ found: true, type: 'standard', id: slot.id, submitted: !!slot.submittedAt });
  }
  res.json({ found: false });
});

// Subida de captura + datos del hueco tras el pago.
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato de imagen no soportado'), ok);
  }
});

app.post('/api/claim', upload.fields([
    { name: 'screenshot', maxCount: 1 },
    { name: 'avatar', maxCount: 1 }
  ]), (req, res) => {
  try {
    const { sessionId, propFirm, payoutRange, xLink } = req.body;
    const data = loadData();

    let target = null;
    if (data.topSlot.stripeSessionId === sessionId) {
      target = data.topSlot;
    } else {
      target = data.slots.find(s => s.stripeSessionId === sessionId);
    }

    if (!target) return res.status(404).json({ error: 'Sesión no encontrada.' });
    const screenshotFile = req.files?.screenshot?.[0];
    const avatarFile = req.files?.avatar?.[0];
    if (!screenshotFile) return res.status(400).json({ error: 'Falta la captura.' });

    target.propFirm = (propFirm || '').slice(0, 60);
    target.payoutRange = (payoutRange || '').slice(0, 30);
    target.xLink = (xLink || '').slice(0, 200);
    target.screenshotFile = screenshotFile.filename;
    target.avatarFile = avatarFile ? avatarFile.filename : null;
    target.submittedAt = new Date().toISOString();
    // Sigue en 'reserved' hasta que el admin lo apruebe manualmente.

    saveData(data);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar tu hueco.' });
  }
});

// ---------- admin (auth básica) ----------
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('Auth requerida');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="admin"');
  return res.status(401).send('Credenciales incorrectas');
}

app.get('/admin/api/pending', adminAuth, (req, res) => {
  const data = loadData();
  const pending = [];
  if (data.topSlot.status === 'reserved' && data.topSlot.submittedAt) {
    pending.push({ id: 'top', type: 'top', ...data.topSlot });
  }
  for (const s of data.slots) {
    if (s.status === 'reserved' && s.submittedAt) {
      pending.push({ id: s.id, type: 'standard', ...s });
    }
  }
  res.json(pending);
});

app.post('/admin/api/approve/:type/:id', adminAuth, (req, res) => {
  const data = loadData();
  const { type, id } = req.params;
  const target = type === 'top' ? data.topSlot : data.slots.find(s => String(s.id) === id);
  if (!target) return res.status(404).json({ error: 'No encontrado.' });
  target.status = 'confirmed';
  saveData(data);
  res.json({ ok: true });
});

app.post('/admin/api/reject/:type/:id', adminAuth, (req, res) => {
  const data = loadData();
  const { type, id } = req.params;
  const target = type === 'top' ? data.topSlot : data.slots.find(s => String(s.id) === id);
  if (!target) return res.status(404).json({ error: 'No encontrado.' });
  // Se limpia lo enviado pero se mantiene el hueco reservado a su nombre,
  // para que pueda volver a subir una captura válida.
  target.propFirm = null;
  target.payoutRange = null;
  target.xLink = null;
  target.screenshotFile = null;
  target.submittedAt = null;
  saveData(data);
  res.json({ ok: true });
});

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Funded Wall corriendo en http://localhost:${PORT}`);
});
