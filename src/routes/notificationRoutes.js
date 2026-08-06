const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', ctrl.getAll);
router.patch('/mark-all-read', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.remove);

module.exports = router;
