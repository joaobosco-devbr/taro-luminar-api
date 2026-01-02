const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN_TEST
});

const paymentClient = new Payment(client);

async function createPayment({ email }) {
  const paymentData = {
    transaction_amount: 9.90,
    description: 'Leitura Tarô Luminar - Sim ou Não',
    payment_method_id: 'pix',
    payer: {
      email: email
    }
  };

  const payment = await paymentClient.create({ body: paymentData });
  return payment;
}

module.exports = {
  createPayment
};

