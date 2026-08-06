const router = require('express').Router();
const ctrl = require('../controllers/storeSettingsController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);
router.get('/', ctrl.get);
router.put('/', ctrl.update);

module.exports = router;
