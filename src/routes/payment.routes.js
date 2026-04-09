const express = require('express');
const router = express.Router();

const { validate } = require('../middlewares/validate');
const paymentService = require('../services/payment.service');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { paymentCreateSchema, webhookSchema } = require('../validation/schemas');

function getErrorMessage(error) {
  return error?.message || String(error);
}

function logWebhookError(message, paymentId, error) {
  logger.error('payment.webhook.error', {
    message,
    paymentId: String(paymentId),
    error: getErrorMessage(error)
  });
}

function persistWebhookFailure(paymentId, error) {
  try {
    paymentService.recordWebhookError(paymentId, error);
  } catch (recordError) {
    logWebhookError('Falha ao registrar erro do webhook', paymentId, recordError);
  }

  try {
    paymentService.releasePaymentClaim(paymentId);
  } catch (releaseError) {
    logWebhookError('Falha ao liberar processamento do pagamento apos erro', paymentId, releaseError);
  }
}

// Criar pagamento PIX
router.post('/create', validate(paymentCreateSchema), async (req, res) => {
  const { email } = req.body;
  metrics.incrementPaymentMetric('createRequests');

  try {
    const payment = await paymentService.createPayment({ email });
    metrics.incrementPaymentMetric('createSuccess');

    logger.info('payment.create.response', {
      paymentId: String(payment.id),
      email,
      status: payment.status
    });

    return res.json({
      id: payment.id,
      status: payment.status,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64:
        payment.point_of_interaction?.transaction_data?.qr_code_base64
    });
  } catch (error) {
    metrics.incrementPaymentMetric('createErrors');
    logger.error('payment.create.error', {
      email,
      error: getErrorMessage(error)
    });
    return res.status(500).json({
      error: 'Erro ao criar pagamento',
      details: error?.message || error
    });
  }
});

// Webhook do Mercado Pago chamado automaticamente quando o PIX e pago
router.post('/webhook', validate(webhookSchema), async (req, res) => {
  const { type, data } = req.body;
  const paymentId = data?.id ? String(data.id) : null;
  metrics.incrementPaymentMetric('webhookReceived');

  if (type !== 'payment' || !paymentId) {
    return res.sendStatus(200);
  }

  try {
    const trackedPayment = paymentService.getTrackedPaymentById(paymentId);

    if (!trackedPayment) {
      metrics.incrementPaymentMetric('webhookIgnored');
      logger.warn('payment.webhook.ignored_untracked', {
        paymentId: String(paymentId)
      });
      return res.sendStatus(200);
    }

    if (trackedPayment.credited) {
      metrics.incrementPaymentMetric('webhookIgnored');
      logger.info('payment.webhook.ignored_already_credited', {
        paymentId: String(paymentId)
      });
      return res.sendStatus(200);
    }

    const claimedPayment = paymentService.claimPaymentForCredit(paymentId);

    if (!claimedPayment) {
      metrics.incrementPaymentMetric('webhookIgnored');
      logger.info('payment.webhook.ignored_unclaimable', {
        paymentId: String(paymentId)
      });
      return res.sendStatus(200);
    }

    const { payment, attempts } = await paymentService.getPaymentByIdWithRetry(paymentId);
    paymentService.markPaymentStatus(paymentId, payment.status);

    if (payment.status !== 'approved') {
      paymentService.releasePaymentClaim(paymentId);
      metrics.incrementPaymentMetric('webhookIgnored');
      logger.info('payment.webhook.non_approved', {
        paymentId: String(paymentId),
        status: payment.status,
        mercadoPagoAttempts: attempts
      });
      return res.sendStatus(200);
    }

    const email = payment.payer?.email;
    const isValidAmount = Number(payment.transaction_amount) === paymentService.CREDIT_PRICE;
    const isTrackedEmail = email === claimedPayment.email;

    if (!email || !isTrackedEmail || !isValidAmount) {
      const inconsistencyError = new Error('Pagamento rejeitado por inconsistenca de dados');
      persistWebhookFailure(paymentId, inconsistencyError);
      metrics.incrementPaymentMetric('webhookRejected');
      logger.warn('payment.webhook.rejected_inconsistent', {
        paymentId,
        email,
        trackedEmail: claimedPayment.email,
        amount: payment.transaction_amount
      });
      return res.sendStatus(200);
    }

    paymentService.applyApprovedPaymentCredit(paymentId, email);
    metrics.incrementPaymentMetric('webhookApproved');

    logger.info('payment.webhook.credit_applied', {
      paymentId: String(paymentId),
      email,
      mercadoPagoAttempts: attempts
    });
    return res.sendStatus(200);
  } catch (error) {
    persistWebhookFailure(paymentId, error);
    metrics.incrementPaymentMetric('webhookErrors');
    logWebhookError('Erro ao processar webhook', paymentId, error);
    return res.sendStatus(500);
  }
});

module.exports = router;
