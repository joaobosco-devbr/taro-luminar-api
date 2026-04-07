const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

// Registrar usuário
router.post('/register', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
  }

  const user = userService.registerUser({ name, email });

  return res.status(201).json({
    message: 'Usuário registrado com sucesso',
    user: {
      name: user.name,
      email: user.email,
      credits: user.credits
    }
  });
});

// Consultar saldo de créditos
router.get('/:email', (req, res) => {
  const { email } = req.params;
  const user = userService.getUserByEmail(email);

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  return res.json({
    name: user.name,
    email: user.email,
    credits: user.credits
  });
});

module.exports = router;
