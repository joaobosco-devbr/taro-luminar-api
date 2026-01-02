const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

router.post('/register', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
  }

  const user = userService.registerUser({ name, email });

  res.json({
    message: 'Usuário registrado com sucesso',
    user: {
      name: user.name,
      email: user.email
    }
  });
});

module.exports = router;

