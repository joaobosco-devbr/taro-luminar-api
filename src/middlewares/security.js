const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

function createRateLimiter(options) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      logger.warn('request.rate_limited', {
        path: req.originalUrl,
        method: req.method,
        ip: req.ip
      });

      return res.status(429).json({
        error: 'Limite de requisicoes excedido'
      });
    }
  });
}

function setSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
}

function enforceJsonContentType(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  if (!req.is('application/json')) {
    logger.warn('request.invalid_content_type', {
      path: req.originalUrl,
      method: req.method,
      contentType: req.headers['content-type'] || null
    });

    return res.status(415).json({
      error: 'Content-Type deve ser application/json'
    });
  }

  next();
}

function containsForbiddenKeys(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(item => containsForbiddenKeys(item));
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }

    if (containsForbiddenKeys(nestedValue)) {
      return true;
    }
  }

  return false;
}

function rejectSuspiciousPayload(req, res, next) {
  if (containsForbiddenKeys(req.body)) {
    logger.warn('request.suspicious_payload', {
      path: req.originalUrl,
      method: req.method
    });

    return res.status(400).json({
      error: 'Payload suspeito rejeitado'
    });
  }

  next();
}

module.exports = {
  createRateLimiter,
  setSecurityHeaders,
  enforceJsonContentType,
  rejectSuspiciousPayload
};
