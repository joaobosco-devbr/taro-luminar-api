const express = require('express');
const router = express.Router();

const tarotService = require('../services/tarot.service');
const userService = require('../services/user.service');
const { validate } = require('../middlewares/validate');
const { tarotReadingSchema } = require('../validation/schemas');

router.post('/sim-ou-nao', validate(tarotReadingSchema), (req, res) => {
  const { email } = req.body;

  const success = userService.consumeCredit(email);

  if (!success) {
    return res.status(403).json({
      error: 'Pagamento necessario para acessar a leitura.'
    });
  }

  const resultado = tarotService.getTarotSimOuNao();

  res.json({
    produto: 'Taro Luminar',
    tipo: 'Taro Sim ou Nao',
    ...resultado
  });
});

module.exports = router;
