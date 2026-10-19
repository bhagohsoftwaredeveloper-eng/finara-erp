const router = require('express').Router();
const ctrl = require('../controllers/salesSummaryController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', ctrl.getSummary);

module.exports = router;
