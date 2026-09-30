const authService = require('../services/auth.service');
const userService = require('../services/user.service');

// POST /api/auth/microsoft with "Authorization: Bearer <Microsoft ID token>"
async function microsoftLogin(req, res) {
  const [scheme, idToken] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !idToken) {
    return res.status(401).json({ message: 'Microsoft token required' });
  }
  res.json(await authService.loginWithMicrosoft(idToken));
}

async function me(req, res) {
  res.json(await userService.getUserById(req.user.id));
}

module.exports = { microsoftLogin, me };
