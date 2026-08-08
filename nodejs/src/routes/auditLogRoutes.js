const router = require('express').Router();
const ctrl = require('../controllers/auditLogController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);
router.get('/', requirePermission('audit_logs', 'read'), ctrl.getAll);
router.get('/entity/:entityName/:entityId', requirePermission('audit_logs', 'read'), ctrl.getByEntity);

module.exports = router;
