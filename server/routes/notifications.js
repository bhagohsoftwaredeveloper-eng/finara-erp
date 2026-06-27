const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/status', ctrl.status);
router.post('/invoice/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.emailInvoice);
router.post('/overdue-reminders', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.sendOverdueReminders);

module.exports = router;
