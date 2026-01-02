const express = require('express');
const router = express.Router();

const paymentService = require('../services/payment.service');

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
    console.error('ERRO REAL MERCADO PAGO:', error);

    return res.status(500).json({
      error: 'Erro ao criar pagamento',
      details: error?.message || error
    });
  }
});

module.exports = router;

