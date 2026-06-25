const router   = require('express').Router();
const ctrl     = require('../controllers/remittanceController');
const dailyCtrl= require('../controllers/dailyRemittanceController');
const { authenticate, authorize } = require('../middleware/auth');

const write = authorize('ADMIN', 'MANAGER', 'ACCOUNTANT');

router.use(authenticate);

// ── Government Remittance (SSS / PhilHealth / Pag-IBIG / BIR 1601-C) ──
router.get('/summary',           ctrl.getSummary);
router.get('/',                  ctrl.list);
router.post('/calculate',        write, ctrl.calculate);
router.post('/',                 write, ctrl.create);
router.put('/:id',               write, ctrl.update);
router.post('/:id/file',         write, ctrl.markFiled);
router.post('/:id/pay',          write, ctrl.markPaid);
router.delete('/:id',            write, ctrl.remove);
router.get('/:id',               ctrl.get);

// ── Daily Remittance ──────────────────────────────────────────────
router.get('/daily/calculate',       dailyCtrl.calculate);
router.get('/daily',                 dailyCtrl.list);
router.post('/daily',                write, dailyCtrl.create);
router.put('/daily/:id',             write, dailyCtrl.update);
router.post('/daily/:id/submit',     write, dailyCtrl.submit);
router.post('/daily/:id/approve',    write, dailyCtrl.approve);
router.delete('/daily/:id',          write, dailyCtrl.remove);
router.get('/daily/:id',             dailyCtrl.get);

module.exports = router;
