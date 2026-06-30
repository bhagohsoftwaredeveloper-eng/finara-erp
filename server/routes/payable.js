const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/payableController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

// Vendors
router.get('/vendors', ctrl.listVendors);
router.post('/vendors', authorize('ADMIN','MANAGER'),
  [body('name').notEmpty().trim(), body('vendorCode').notEmpty().trim()], validate, ctrl.createVendor);
router.put('/vendors/:id', authorize('ADMIN','MANAGER'), ctrl.updateVendor);

// Bills
router.get('/', ctrl.listBills);
router.get('/aging', ctrl.agingReport);
router.get('/:id', param('id').isInt(), validate, ctrl.getBill);
router.post('/',
  [
    body('vendorId').isInt(),
    body('billDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.createBill);
router.post('/:id/payment',
  [
    param('id').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, ctrl.recordPayment);
router.post('/:id/void', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.voidBill);

module.exports = router;
