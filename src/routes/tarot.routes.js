const express = require('express');
const router = express.Router();

const tarotService = require('../services/tarot.service');
const userService = require('../services/user.service');

router.post('/sim-ou-nao', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório' });
  }

  const success = userService.consumeCredit(email);

  if (!success) {
    return res.status(403).json({
      error: 'Pagamento necessário para acessar a leitura.'
    });
  }

  const resultado = tarotService.getTarotSimOuNao();

  res.json({
    produto: 'Tarô Luminar',
    tipo: 'Tarot Sim ou Não',
    ...resultado
  });
});

module.exports = router;

