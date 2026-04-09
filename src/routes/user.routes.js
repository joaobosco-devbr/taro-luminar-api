const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');
const { validate } = require('../middlewares/validate');
const { registerUserSchema, emailParamSchema } = require('../validation/schemas');

// Registrar usuario
router.post('/register', validate(registerUserSchema), (req, res) => {
  const { name, email } = req.body;

  const { created, user } = userService.registerUser({ name, email });

  if (!created) {
    return res.status(409).json({ error: 'Usuario ja cadastrado' });
  }

  return res.status(201).json({
    message: 'Usuario registrado com sucesso',
    user: {
      name: user.name,
      email: user.email,
      credits: user.credits
    }
  });
});

// Consultar saldo de creditos
router.get('/:email', validate(emailParamSchema, 'params'), (req, res) => {
  const { email } = req.params;
  const user = userService.getUserByEmail(email);

  if (!user) {
    return res.status(404).json({ error: 'Usuario nao encontrado' });
  }

  return res.json({
    name: user.name,
    email: user.email,
    credits: user.credits
  });
});

module.exports = router;
