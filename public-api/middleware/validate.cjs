'use strict';

/**
 * Central Zod validation middleware for body / query / params.
 * Invalid input → 400 + { error: 'validation_error', issues: [...] }
 */
function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) {
          res.status(400).json(formatValidationError(parsed.error));
          return;
        }
        req.params = parsed.data;
      }

      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json(formatValidationError(parsed.error));
          return;
        }
        req.query = parsed.data;
      }

      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json(formatValidationError(parsed.error));
          return;
        }
        req.body = parsed.data;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

function formatValidationError(zodError) {
  return {
    error: 'validation_error',
    issues: zodError.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    })),
  };
}

module.exports = { validate, formatValidationError };
