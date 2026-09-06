const router = require('express').Router();
const ctrl = require('../controllers/customerController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');
const { validateCustomer, handleValidationErrors } = require('../validators');

router.use(authenticate, storeContext);

router.get('/search', ctrl.search);
router.get('/', requirePermission('customers', 'read'), ctrl.getAll);
router.get('/:id', requirePermission('customers', 'read'), ctrl.getById);
router.post('/', requirePermission('customers', 'create'), validateCustomer, handleValidationErrors, ctrl.create);
router.put('/:id', requirePermission('customers', 'update'), validateCustomer, handleValidationErrors, ctrl.update);
router.delete('/:id', requirePermission('customers', 'delete'), ctrl.remove);

module.exports = router;
