const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const ctrl = require('../controllers/settingsController');

// All settings routes require authentication
router.use(authenticate, resolveBusiness);

// Settings CRUD
router.get('/',        ctrl.getAll);
router.post('/',       authorize('ADMIN', 'MANAGER'), ctrl.saveAll);
router.post('/reset-defaults', authorize('ADMIN'), ctrl.resetDefaults);

// Database operations
router.get('/db-stats',  ctrl.getDbStats);
router.get('/backup',    authorize('ADMIN'), ctrl.backupDatabase);
router.post('/db-reset', authorize('ADMIN'), ctrl.resetDatabase);

// User management
router.get('/users',              authorize('ADMIN'), ctrl.listUsers);
router.put('/users/:id',          authorize('ADMIN'), ctrl.updateUser);
router.delete('/users/:id',       authorize('ADMIN'), ctrl.deleteUser);
router.post('/users/:id/reset-password', authorize('ADMIN'), ctrl.resetUserPassword);

// Payment Terms
router.get('/payment-terms',        ctrl.listPaymentTerms);
router.post('/payment-terms',       authorize('ADMIN', 'MANAGER'), ctrl.createPaymentTerm);
router.put('/payment-terms/:id',    authorize('ADMIN', 'MANAGER'), ctrl.updatePaymentTerm);
router.delete('/payment-terms/:id', authorize('ADMIN', 'MANAGER'), ctrl.deletePaymentTerm);

module.exports = router;
