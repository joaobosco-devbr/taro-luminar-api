const logger = require('../utils/logger');

function formatZodIssues(issues) {
  return issues.map(issue => ({
    path: issue.path.join('.') || 'root',
    message: issue.message
  }));
}

function validate(schema, target = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const details = formatZodIssues(result.error.issues);

      logger.warn('request.validation.failed', {
        target,
        path: req.originalUrl,
        method: req.method,
        details
      });

      return res.status(400).json({
        error: 'Dados invalidos',
        details
      });
    }

    req[target] = result.data;
    next();
  };
}

module.exports = {
  validate
};
