const router = require('express').Router();
const ctrl = require('../controllers/supplierController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
