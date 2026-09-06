const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.post('/create-order', ctrl.createOrder);
router.post('/verify', ctrl.verifyPayment);
router.post('/refund', ctrl.refund);
router.get('/details/:paymentId', ctrl.getDetails);

module.exports = router;
