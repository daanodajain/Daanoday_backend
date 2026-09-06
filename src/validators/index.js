const { body, validationResult } = require('express-validator');

const validateCustomer = [
  body('name').trim().notEmpty().withMessage('Name required').isLength({ min: 2, max: 255 }).withMessage('Name 2-255 chars'),
  body('mobile').trim().matches(/^[6-9]\d{9}$/).withMessage('Invalid mobile format'),
  body('email').optional().trim().isEmail().withMessage('Invalid email'),
];

const validateReceipt = [
  body('customerId').isInt({ min: 1 }).withMessage('Invalid customer'),
  body('totalAmount').isFloat({ min: 0.01 }).withMessage('Amount > 0'),
  body('paymentMode').isIn(['CASH', 'CHEQUE', 'ONLINE']).withMessage('Invalid payment mode'),
];

const validateUser = [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('email').trim().isEmail().withMessage('Invalid email'),
  body('mobile').trim().matches(/^[6-9]\d{9}$/).withMessage('Invalid mobile'),
];

const validateSupplier = [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('mobile').optional().trim().matches(/^[6-9]\d{9}$/).withMessage('Invalid mobile'),
];

const validateParticular = [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('type').isIn(['RECEIPT', 'CHALLAN']).withMessage('Invalid type'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const { error } = require('../utils/response');
    return error(res, 'VALIDATION_ERROR', 400, errors.array());
  }
  next();
};

module.exports = {
  validateCustomer,
  validateReceipt,
  validateUser,
  validateSupplier,
  validateParticular,
  handleValidationErrors,
};
