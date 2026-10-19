const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const ctrl = require('../controllers/businessController');

const adminOnly = authorize('ADMIN');

// `list` must NOT go through resolveBusiness: a user whose currently-selected
// business gets suspended would otherwise be 403'd on the very request that
// populates the business switcher, locking them out of the whole app.
// `onboard` works before the user has a business, so it also skips resolveBusiness.
router.get('/',            authenticate,     ctrl.list);
router.post('/onboard',    authenticate,     ctrl.onboard);

// The operator's module switches for ANY business. Like `list`, these skip resolveBusiness on purpose:
// they touch only that business's module settings (never its books), and must keep working
// whatever business the operator currently has selected.
router.get('/:id/modules', authenticate, authorize('SUPER_ADMIN'), ctrl.getModules);
router.put('/:id/modules', authenticate, authorize('SUPER_ADMIN'), ctrl.saveModules);

router.use(authenticate, resolveBusiness);

router.post('/reset-demo', adminOnly,        ctrl.resetDemo);
router.get('/:id',                           ctrl.get);
router.post('/',           adminOnly,        ctrl.create);
router.put('/:id',         adminOnly,        ctrl.update);
router.patch('/:id/license', authorize('SUPER_ADMIN'), ctrl.updateLicense);
router.delete('/:id/license/schedule', authorize('SUPER_ADMIN'), ctrl.cancelScheduledSuspension);
router.post('/:id/license/payment-link', authorize('SUPER_ADMIN'), ctrl.generatePaymentLink);
router.get('/:id/users',   adminOnly,        ctrl.listUsers);
router.post('/:id/users',  adminOnly,        ctrl.grantUser);
router.delete('/:id/users/:userId', adminOnly, ctrl.revokeUser);

module.exports = router;
