const router = require('express').Router();
const ctrl = require('../controllers/permissionsController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.get);                       // any authenticated user (to know their own access)
router.put('/', authorize('ADMIN'), ctrl.save);  // only ADMIN may change permissions

module.exports = router;
