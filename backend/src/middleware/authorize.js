const ROLES = {
  FRONT_DESK: 'front-desk',
  PROVIDER: 'provider',
};

/**
 * Middleware factory: allow only users with one of the specified roles.
 * Usage: router.post('/slots', authenticate, authorize('front-desk'), handler)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

module.exports = { authorize, ROLES };
