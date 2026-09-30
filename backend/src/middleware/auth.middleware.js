const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');

/**
 * Checks the app JWT, then the user's current record in MySQL on every request, so that
 * deactivating an account or changing a role takes effect right away instead of when the
 * token expires. req.user.role is the current role from the database.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  const user = await User.findByPk(payload.id, { attributes: ['id', 'email', 'role', 'isActive'] });
  if (!user) return res.status(401).json({ message: 'Account not found' });
  if (!user.isActive) {
    return res.status(401).json({
      code: 'ACCOUNT_DISABLED',
      message: 'Your account has been deactivated. Please contact the ICT office.',
    });
  }

  req.user = { id: user.id, email: user.email, role: user.role };
  next();
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
