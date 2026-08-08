const router = require('express').Router();
const ctrl = require('../controllers/transactionController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);

module.exports = router;
