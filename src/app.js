require('dotenv').config();

const express = require('express');
const { randomUUID } = require('node:crypto');
const cors = require('cors');

const tarotRoutes = require('./routes/tarot.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const {
  createRateLimiter,
  setSecurityHeaders,
  enforceJsonContentType,
  rejectSuspiciousPayload
} = require('./middlewares/security');

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const generalRateLimiter = createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 100)
});
const webhookRateLimiter = createRateLimiter({
  windowMs: Number(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.WEBHOOK_RATE_LIMIT_MAX || 30)
});

// =======================
// Middlewares globais
// =======================
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const requestIdHeader = req.headers['x-request-id'];
  const requestId = typeof requestIdHeader === 'string' && requestIdHeader.trim()
    ? requestIdHeader
    : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  logger.runWithRequestContext(requestId, next);
});

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordRequest(req, res, Number(durationMs.toFixed(2)));
  });

  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn('request.cors_blocked', { origin });
    return callback(new Error('Origem nao permitida'));
  }
}));
app.use(setSecurityHeaders);
app.use(enforceJsonContentType);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '16kb', strict: true }));
app.use(rejectSuspiciousPayload);
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/payment/webhook') {
    return webhookRateLimiter(req, res, next);
  }

  return generalRateLimiter(req, res, next);
});

// =======================
// Rotas publicas (sem API key)
// =======================
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// =======================
// Middleware de seguranca
// =======================
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/payment/webhook') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }

  next();
});

// =======================
// Rotas protegidas
// =======================
app.get('/metrics', (req, res) => {
  res.json(metrics.snapshot());
});

app.use('/users', userRoutes);
app.use('/payment', paymentRoutes);
app.use('/tarot', tarotRoutes);

app.use((error, req, res, next) => {
  if (error?.message === 'Origem nao permitida') {
    return res.status(403).json({
      error: 'Origem nao permitida'
    });
  }

  if (error?.type === 'entity.too.large') {
    logger.warn('request.body_too_large', {
      path: req.originalUrl,
      method: req.method
    });

    return res.status(413).json({
      error: 'Payload excede o limite permitido'
    });
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    logger.warn('request.invalid_json', {
      path: req.originalUrl,
      method: req.method
    });

    return res.status(400).json({
      error: 'JSON invalido'
    });
  }

  logger.error('request.unhandled_error', {
    path: req.originalUrl,
    method: req.method,
    error: error?.message || String(error)
  });

  return res.status(500).json({
    error: 'Erro interno do servidor'
  });
});

module.exports = app;
