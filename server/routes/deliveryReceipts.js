const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/deliveryReceiptController');
const { authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// authenticate + resolveBusiness are applied by the parent receivable router.
router.get('/', ctrl.list);
router.get('/:id', param('id').isInt(), validate, ctrl.get);
router.post('/', [body('drDate').isISO8601()], validate, ctrl.create);
router.put('/:id', [param('id').isInt()], validate, ctrl.update);
router.post('/:id/deliver', param('id').isInt(), validate, ctrl.deliver);
router.post('/:id/link', [param('id').isInt(), body('invoiceId').isInt()], validate, ctrl.link);
router.post('/:id/unlink', param('id').isInt(), validate, ctrl.unlink);
router.post('/:id/cancel', authorize('ADMIN', 'MANAGER'), param('id').isInt(), validate, ctrl.cancel);

module.exports = router;
