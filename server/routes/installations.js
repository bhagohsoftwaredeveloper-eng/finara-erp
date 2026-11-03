const router = require('express').Router();
const ctrl = require('../controllers/installationController');

// No `authenticate`: installed copies call this with the shared INSTALL_API_KEY (checked in the controller).
router.post('/register', ctrl.register);
router.post('/status', ctrl.status);

module.exports = router;
