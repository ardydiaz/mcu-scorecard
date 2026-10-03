const authService = require('../services/auth.service');
const userService = require('../services/user.service');
const { audit } = require('../services/audit.service');

// POST /api/auth/microsoft with "Authorization: Bearer <Microsoft ID token>"
async function microsoftLogin(req, res) {
  const [scheme, idToken] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !idToken) {
    return res.status(401).json({ message: 'Microsoft token required' });
  }
  try {
    const result = await authService.loginWithMicrosoft(idToken);
    await audit(req, 'auth.login', {
      actor: result.user,
      target: result.user.email,
      details: { department: result.user.department, role: result.user.role },
    });
    res.json(result);
  } catch (err) {
    if (err.actor) {
      await audit(req, 'auth.login_denied', { actor: err.actor, target: err.actor.email, details: { reason: err.message } });
    } else if (err.status === 401) {
      // Invalid/expired Microsoft token: nobody identified, but the IP and browser are recorded
      await audit(req, 'auth.login_failed', { details: { reason: err.message } });
    }
    throw err;
  }
}

async function me(req, res) {
  res.json(await userService.getUserById(req.user.id));
}

// The app token lives in the browser, so signing out is recorded here before it's discarded
async function logout(req, res) {
  // The browser signs users out by itself after 20 minutes of inactivity
  const automatic = req.body?.reason === 'inactivity';
  await audit(req, 'auth.logout', { target: req.user.email, ...(automatic && { details: { reason: 'Inactive for 20 minutes' } }) });
  res.status(204).end();
}

module.exports = { microsoftLogin, me, logout };
