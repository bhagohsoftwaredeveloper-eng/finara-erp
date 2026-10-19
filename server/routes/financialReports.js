const router = require('express').Router();
const ctrl = require('../controllers/profitLossController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/profit-loss', ctrl.getProfitLoss);
router.get('/expenses-summary', ctrl.getExpensesSummary);

module.exports = router;
