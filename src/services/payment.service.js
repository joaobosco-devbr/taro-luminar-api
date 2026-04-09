const { MercadoPagoConfig, Payment } = require('mercadopago');
const { db, mapPayment } = require('../config/database');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN_TEST
});

const paymentClient = new Payment(client);
const CREDIT_PRICE = 9.9;
const DEFAULT_WEBHOOK_MAX_RETRIES = Number(process.env.PAYMENT_WEBHOOK_MAX_RETRIES || 3);
const DEFAULT_WEBHOOK_RETRY_DELAY_MS = Number(process.env.PAYMENT_WEBHOOK_RETRY_DELAY_MS || 250);

function now() {
  return new Date().toISOString();
}

function wait(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function trackPayment(payment) {
  const paymentId = String(payment.id);
  const timestamp = now();

  db.prepare(
    `INSERT INTO payments (
       id, email, amount, status, credited, credit_processing,
       webhook_attempts, last_webhook_error, last_webhook_error_at,
       processing_started_at, credited_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       amount = excluded.amount,
       status = excluded.status,
       credited = excluded.credited,
       credit_processing = excluded.credit_processing,
       webhook_attempts = excluded.webhook_attempts,
       last_webhook_error = excluded.last_webhook_error,
       last_webhook_error_at = excluded.last_webhook_error_at,
       processing_started_at = excluded.processing_started_at,
       credited_at = excluded.credited_at,
       updated_at = excluded.updated_at`
  ).run(
    paymentId,
    payment.email,
    payment.amount,
    payment.status,
    Number(Boolean(payment.credited)),
    Number(Boolean(payment.creditProcessing)),
    payment.webhookAttempts ?? 0,
    payment.lastWebhookError ?? null,
    payment.lastWebhookErrorAt ?? null,
    payment.processingStartedAt || null,
    payment.creditedAt || null,
    payment.createdAt || timestamp,
    timestamp
  );

  return getTrackedPaymentById(paymentId);
}

async function createPayment({ email }) {
  const paymentData = {
    transaction_amount: CREDIT_PRICE,
    description: 'Leitura Taro Luminar - Sim ou Nao',
    payment_method_id: 'pix',
    external_reference: `tarot-credit:${email}`,
    metadata: {
      product: 'tarot-credit',
      credits: 1,
      email
    },
    payer: {
      email
    }
  };

  const payment = await paymentClient.create({ body: paymentData });

  trackPayment({
    id: payment.id,
    email,
    amount: CREDIT_PRICE,
    status: payment.status,
    credited: false,
    creditProcessing: false,
    webhookAttempts: 0,
    lastWebhookError: null,
    lastWebhookErrorAt: null,
    createdAt: new Date().toISOString()
  });

  logger.info('payment.create.success', {
    paymentId: String(payment.id),
    email,
    amount: CREDIT_PRICE,
    status: payment.status
  });

  return payment;
}

async function getPaymentById(paymentId) {
  return paymentClient.get({ id: paymentId });
}

async function getPaymentByIdWithRetry(paymentId, options = {}) {
  const maxRetries = options.maxRetries || DEFAULT_WEBHOOK_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_WEBHOOK_RETRY_DELAY_MS;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const payment = await module.exports.getPaymentById(paymentId);
      return { payment, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      metrics.incrementPaymentMetric('webhookRetries');
      logger.warn('payment.webhook.retry', {
        paymentId: String(paymentId),
        attempt,
        maxRetries,
        retryDelayMs,
        error: getErrorMessage(error)
      });

      await wait(retryDelayMs);
    }
  }

  throw lastError;
}

function getTrackedPaymentById(paymentId) {
  const row = db.prepare(
    `SELECT id, email, amount, status, credited, credit_processing,
            webhook_attempts, last_webhook_error, last_webhook_error_at,
            processing_started_at, credited_at, created_at, updated_at
     FROM payments
     WHERE id = ?`
  ).get(String(paymentId));

  return mapPayment(row);
}

function markPaymentStatus(paymentId, status) {
  const payment = getTrackedPaymentById(paymentId);

  if (!payment) {
    return null;
  }

  return trackPayment({
    ...payment,
    status
  });
}

function claimPaymentForCredit(paymentId) {
  const timestamp = now();
  const result = db.prepare(
    `UPDATE payments
     SET credit_processing = 1,
         webhook_attempts = webhook_attempts + 1,
         processing_started_at = ?,
         updated_at = ?
     WHERE id = ?
       AND credited = 0
       AND credit_processing = 0`
  ).run(timestamp, timestamp, String(paymentId));

  if (result.changes === 0) {
    return null;
  }

  return getTrackedPaymentById(paymentId);
}

function releasePaymentClaim(paymentId) {
  const timestamp = now();
  const result = db.prepare(
    `UPDATE payments
     SET credit_processing = 0,
         processing_started_at = NULL,
         updated_at = ?
     WHERE id = ?`
  ).run(timestamp, String(paymentId));

  if (result.changes === 0) {
    return null;
  }

  return getTrackedPaymentById(paymentId);
}

function markPaymentAsCredited(paymentId) {
  const timestamp = now();
  const result = db.prepare(
    `UPDATE payments
     SET credited = 1,
         credit_processing = 0,
         last_webhook_error = NULL,
         last_webhook_error_at = NULL,
         processing_started_at = NULL,
         credited_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(timestamp, timestamp, String(paymentId));

  if (result.changes === 0) {
    return null;
  }

  return getTrackedPaymentById(paymentId);
}

function recordWebhookError(paymentId, error) {
  const timestamp = now();
  const result = db.prepare(
    `UPDATE payments
     SET last_webhook_error = ?,
         last_webhook_error_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(getErrorMessage(error), timestamp, timestamp, String(paymentId));

  if (result.changes === 0) {
    return null;
  }

  return getTrackedPaymentById(paymentId);
}

function applyApprovedPaymentCredit(paymentId, email) {
  const timestamp = now();
  const normalizedPaymentId = String(paymentId);

  db.exec('BEGIN IMMEDIATE');

  try {
    const payment = db.prepare(
      `SELECT id, credited, credit_processing
       FROM payments
       WHERE id = ?`
    ).get(normalizedPaymentId);

    if (!payment || payment.credited || !payment.credit_processing) {
      db.exec('ROLLBACK');
      return null;
    }

    let user = db.prepare(
      `SELECT id
       FROM users
       WHERE email = ?`
    ).get(email);

    if (!user) {
      db.prepare(
        `INSERT INTO users (name, email, credits, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)`
      ).run(email, email, timestamp, timestamp);

      user = db.prepare(
        `SELECT id
         FROM users
         WHERE email = ?`
      ).get(email);
    }

    db.prepare(
      `UPDATE users
       SET credits = credits + 1,
           updated_at = ?
       WHERE id = ?`
    ).run(timestamp, user.id);

    db.prepare(
      `INSERT INTO credits_ledger (user_id, payment_id, delta, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, normalizedPaymentId, 1, 'payment_credit', timestamp);

    const paymentResult = db.prepare(
      `UPDATE payments
       SET credited = 1,
           credit_processing = 0,
           last_webhook_error = NULL,
           last_webhook_error_at = NULL,
           processing_started_at = NULL,
           credited_at = ?,
           updated_at = ?
       WHERE id = ?
         AND credited = 0
         AND credit_processing = 1`
    ).run(timestamp, timestamp, normalizedPaymentId);

    if (paymentResult.changes === 0) {
      throw new Error(`Nao foi possivel finalizar o pagamento ${normalizedPaymentId}`);
    }

    db.exec('COMMIT');
    return getTrackedPaymentById(normalizedPaymentId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  CREDIT_PRICE,
  createPayment,
  getPaymentById,
  getPaymentByIdWithRetry,
  getTrackedPaymentById,
  markPaymentStatus,
  claimPaymentForCredit,
  releasePaymentClaim,
  markPaymentAsCredited,
  recordWebhookError,
  applyApprovedPaymentCredit
};
