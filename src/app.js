require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const tarotRoutes = require('./routes/tarot.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');

const app = express();

// =======================
// Middlewares globais
// =======================
app.use(cors());
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

// =======================
// Rotas públicas (sem API Key)
// =======================
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Webhook do Mercado Pago é chamado diretamente por eles — sem API Key
app.use('/payment/webhook', paymentRoutes);

// =======================
// Middleware de segurança (API KEY)
// =======================
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  next();
});

// =======================
// Rotas protegidas
// =======================
app.use('/users', userRoutes);
app.use('/payment', paymentRoutes);
app.use('/tarot', tarotRoutes);

module.exports = app;
