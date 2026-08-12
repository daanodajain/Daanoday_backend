const svc = require('../services/receiptService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getById = async (req, res) => {
  try { success(res, await svc.getById(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { success(res, await svc.create(req.body, req.storeId, req.user.id), 201); }
  catch (e) { error(res, e.message); }
};

const approve = async (req, res) => {
  try { success(res, await svc.approveReceipt(req.params.id, req.storeId, req.user.id, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const reject = async (req, res) => {
  try { success(res, await svc.rejectReceipt(req.params.id, req.storeId, req.user.id, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const getPending = async (req, res) => {
  try { success(res, await svc.getPendingApprovals(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getByDateRange = async (req, res) => {
  try { success(res, await svc.getByDateRange(req.storeId, req.query.startDate, req.query.endDate)); }
  catch (e) { error(res, e.message); }
};

const stateChange = async (req, res) => {
  try { success(res, await svc.changeState(req.params.id, req.storeId, req.user.id, req.body.state, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const pay = async (req, res) => {
  try { success(res, await svc.markPaid(req.params.id, req.storeId, req.user.id, req.body?.paymentMode)); }
  catch (e) { error(res, e.message); }
};

const collectRemaining = async (req, res) => {
  try { success(res, await svc.collectRemaining(req.params.id, req.storeId, req.user.id, req.body?.paymentMode, req.body?.paymentDate)); }
  catch (e) { error(res, e.message); }
};

const getApprovals = async (req, res) => {
  try { success(res, await svc.getApprovals(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

// PDF — generate a real PDF receipt using pdfkit (Hostinger-safe, no Chromium needed)
const PDFDocument = require('pdfkit');

const getPdf = async (req, res) => {
  try {
    const receipt = await svc.getById(req.params.id, req.storeId);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${receipt.receipt_number}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('RECEIPT', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10).font('Helvetica');
    const metaLeftX = 50, metaRightX = 320, metaY = doc.y;
    doc.text(`Receipt No: ${receipt.receipt_number}`, metaLeftX, metaY);
    doc.text(`Date: ${new Date(receipt.created_at).toLocaleDateString('en-IN')}`, metaRightX, metaY);
    doc.moveDown(0.6);
    let y2 = doc.y;
    doc.text(`Customer: ${receipt.customer_name}`, metaLeftX, y2);
    doc.text(`Mobile: ${receipt.customer_mobile}`, metaRightX, y2);
    doc.moveDown(0.6);
    let y3 = doc.y;
    doc.text(`Account No: ${receipt.account_number}`, metaLeftX, y3);
    doc.text(`Payment Mode: ${receipt.payment_mode || '-'}`, metaRightX, y3);
    doc.moveDown(1.5);

    // Particulars table
    const tableTop = doc.y;
    const col1 = 50, col2 = 380, col3 = 470, tableWidth = 495;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Particular', col1, tableTop);
    doc.text('Amount', col2, tableTop, { width: 90, align: 'right' });
    doc.text('Paid', col3, tableTop, { width: 75, align: 'right' });
    doc.moveTo(col1, tableTop + 15).lineTo(col1 + tableWidth, tableTop + 15).stroke();

    let rowY = tableTop + 22;
    doc.font('Helvetica').fontSize(10);
    for (const p of (receipt.particulars || [])) {
      doc.text(p.particular_name, col1, rowY);
      doc.text(`Rs. ${Number(p.amount).toLocaleString('en-IN')}`, col2, rowY, { width: 90, align: 'right' });
      doc.text(`Rs. ${Number(p.paid_amount ?? p.amount).toLocaleString('en-IN')}`, col3, rowY, { width: 75, align: 'right' });
      rowY += 20;
    }
    doc.moveTo(col1, rowY + 2).lineTo(col1 + tableWidth, rowY + 2).stroke();

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total: Rs. ${Number(receipt.total_amount).toLocaleString('en-IN')}`, { align: 'right' });
    if (receipt.status === 'PARTIAL') {
      const due = Number(receipt.total_amount) - Number(receipt.paid_amount || 0);
      doc.fontSize(10).fillColor('#b45309');
      doc.text(`Paid: Rs. ${Number(receipt.paid_amount || 0).toLocaleString('en-IN')}`, { align: 'right' });
      doc.text(`Due: Rs. ${due.toLocaleString('en-IN')}`, { align: 'right' });
      doc.fillColor('black');
    }

    doc.moveDown(3);
    doc.fontSize(9).font('Helvetica').fillColor('#888')
      .text(`Status: ${receipt.receipt_state} | Generated on ${new Date().toLocaleString('en-IN')}`, { align: 'center' });

    doc.end();
  } catch (e) {
    error(res, e.message);
  }
};

// Direct PUT/DELETE not allowed — must use change_requests
const notAllowed = (req, res) =>
  res.status(405).json({ status: 'ERROR', DDMS_error_code: 'USE_CHANGE_REQUEST_ENDPOINT' });

module.exports = { getAll, getById, create, approve, reject, getPending, getByDateRange, stateChange, pay, collectRemaining, getApprovals, getPdf, notAllowed };
