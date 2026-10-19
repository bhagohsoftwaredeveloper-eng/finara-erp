const router = require('express').Router();
const ctrl = require('../controllers/fundsController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/config', ctrl.getConfig);
router.put('/config', authorize('ADMIN', 'MANAGER'), ctrl.saveConfig);
router.post('/marketing/account', authorize('ADMIN', 'MANAGER'), ctrl.createMarketingAccount);
router.get('/summary', ctrl.getSummary);
router.get('/marketing/allocation', ctrl.getAllocation);
router.post('/marketing/allocation', authorize('ADMIN', 'MANAGER'), ctrl.postAllocation);

module.exports = router;
