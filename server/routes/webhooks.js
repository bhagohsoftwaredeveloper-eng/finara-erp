const router = require('express').Router();
const ctrl = require('../controllers/webhookController');

// No `authenticate` — PayMongo calls this unauthenticated. The HMAC
// signature check inside the controller is the authentication.
router.post('/paymongo', ctrl.paymongo);

module.exports = router;
