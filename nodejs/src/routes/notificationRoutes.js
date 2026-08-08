const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', ctrl.getAll);
router.get('/unread-count', ctrl.getUnreadCount);
router.post('/', ctrl.create);
router.patch('/mark-all-read', ctrl.markAllRead);
router.put('/mark-all-read', ctrl.markAllRead);   // frontend duplicate — support both
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.remove);

module.exports = router;
