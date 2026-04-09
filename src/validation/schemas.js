const { z } = require('zod');

const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());

const userNameSchema = z.string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\p{L}\p{N}\s.'-]+$/u, 'Nome contem caracteres invalidos');

const registerUserSchema = z.object({
  name: userNameSchema,
  email: emailSchema
});

const emailParamSchema = z.object({
  email: emailSchema
});

const paymentCreateSchema = z.object({
  email: emailSchema
});

const tarotReadingSchema = z.object({
  email: emailSchema
});

const webhookSchema = z.object({
  type: z.string().trim().max(50),
  data: z.object({
    id: z.union([z.string().trim().min(1).max(100), z.number().int().nonnegative()])
  }).optional()
});

module.exports = {
  registerUserSchema,
  emailParamSchema,
  paymentCreateSchema,
  tarotReadingSchema,
  webhookSchema
};
