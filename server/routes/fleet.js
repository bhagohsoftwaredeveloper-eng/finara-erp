const router = require('express').Router();
const { param } = require('express-validator');
const ctrl = require('../controllers/fleetController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, resolveBusiness);

const WRITE = authorize('ADMIN', 'MANAGER', 'ACCOUNTANT');

router.get('/drivers', ctrl.listDrivers);
router.post('/drivers', WRITE, ctrl.createDriver);
router.put('/drivers/:id', WRITE, param('id').isInt(), validate, ctrl.updateDriver);

router.get('/vehicles', ctrl.listVehicles);
router.post('/vehicles', WRITE, ctrl.createVehicle);
router.put('/vehicles/:id', WRITE, param('id').isInt(), validate, ctrl.updateVehicle);

module.exports = router;
