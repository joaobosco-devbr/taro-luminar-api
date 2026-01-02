require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Rotas
const tarotRoutes = require('./routes/tarot.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');

const app = express();

// =======================
// Middlewares globais
// =======================

// CORS (aberto por enquanto)
app.use(cors());

// Permitir JSON
app.use(express.json());

// Rate limit (proteção básica)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100,
  })
);

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
// Rotas da aplicação
// =======================
app.use('/users', userRoutes);
app.use('/payment', paymentRoutes);
app.use('/tarot', tarotRoutes);

// =======================
// Health check
// =======================
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;

