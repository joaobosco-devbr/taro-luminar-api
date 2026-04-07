const express = require('express');
const router = express.Router();

const paymentService = require('../services/payment.service');
const userService = require('../services/user.service');

// Criar pagamento PIX
router.post('/create', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório' });
  }

  try {
    const payment = await paymentService.createPayment({ email });

    return res.json({
      id: payment.id,
      status: payment.status,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64:
        payment.point_of_interaction?.transaction_data?.qr_code_base64
    });
  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    return res.status(500).json({
      error: 'Erro ao criar pagamento',
      details: error?.message || error
    });
  }
});

// Webhook do Mercado Pago — chamado automaticamente quando o PIX é pago
router.post('/webhook', async (req, res) => {
  const { type, data } = req.body;

  // MP envia notificações de vários tipos — só processamos pagamentos aprovados
  if (type !== 'payment') {
    return res.sendStatus(200);
  }

  try {
    const payment = await paymentService.getPaymentById(data.id);

    if (payment.status !== 'approved') {
      return res.sendStatus(200);
    }

    const email = payment.payer?.email;

    if (!email) {
      console.warn('Webhook: pagamento aprovado sem e-mail do pagador', data.id);
      return res.sendStatus(200);
    }

    const user = userService.addCredit(email);

    if (!user) {
      // Usuário não cadastrado ainda — registra automaticamente com 1 crédito
      userService.registerUser({ name: email, email });
      userService.addCredit(email);
    }

    console.log(`Crédito adicionado para ${email} via pagamento ${data.id}`);
    return res.sendStatus(200);
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    return res.sendStatus(500);
  }
});

module.exports = router;
