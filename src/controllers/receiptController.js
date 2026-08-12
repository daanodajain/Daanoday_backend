const svc       = require('../services/receiptService');
const settingsSvc = require('../services/storeSettingsService');
const { success, error } = require('../utils/response');
const PDFDocument = require('pdfkit');

const getAll        = async (req, res) => { try { success(res, await svc.getAll(req.storeId, req.query)); } catch (e) { error(res, e.message); } };
const getById       = async (req, res) => { try { success(res, await svc.getById(req.params.id, req.storeId)); } catch (e) { error(res, e.message); } };
const create        = async (req, res) => { try { success(res, await svc.create(req.body, req.storeId, req.user.id), 201); } catch (e) { error(res, e.message); } };
const approve       = async (req, res) => { try { success(res, await svc.approveReceipt(req.params.id, req.storeId, req.user.id)); } catch (e) { error(res, e.message); } };
const reject        = async (req, res) => { try { success(res, await svc.rejectReceipt(req.params.id, req.storeId, req.user.id, req.body.reason)); } catch (e) { error(res, e.message); } };
const getPending    = async (req, res) => { try { success(res, await svc.getPending(req.storeId)); } catch (e) { error(res, e.message); } };
const getByDateRange = async (req, res) => { try { success(res, await svc.getByDateRange(req.storeId, req.query)); } catch (e) { error(res, e.message); } };
const stateChange   = async (req, res) => { try { success(res, await svc.stateChange(req.params.id, req.storeId, req.body.state)); } catch (e) { error(res, e.message); } };
const pay           = async (req, res) => { try { success(res, await svc.pay(req.params.id, req.storeId, req.body)); } catch (e) { error(res, e.message); } };
const collectRemaining = async (req, res) => { try { success(res, await svc.collectRemaining(req.params.id, req.storeId, req.body, req.user.id)); } catch (e) { error(res, e.message); } };
const getApprovals  = async (req, res) => { try { success(res, await svc.getApprovals(req.storeId)); } catch (e) { error(res, e.message); } };

// ── PDF Generation ──────────────────────────────────────────────────────────
const getPdf = async (req, res) => {
  try {
    const receipt = await svc.getById(req.params.id, req.storeId);
    
    // Fetch store settings for template + header text
    let settings = {};
    try { settings = await settingsSvc.getByStore(req.storeId); } catch(e) {}
    
    const template = settings.receipt_template || 'DEFAULT';
    const headerText = settings.receipt_header_text || '';
    
    // Store info from receipt
    const storeName = receipt.store_name || 'Temple';
    const storeAddress = receipt.store_address || '';
    const storeContact = receipt.store_contact || '';
    const storeEmail = receipt.store_email || '';

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${receipt.receipt_number}.pdf"`);
    doc.pipe(res);

    const W = 595.28; // A4 width in points
    const margin = 45;
    const contentW = W - margin * 2;

    // ── Helper functions ──────────────────────────────────────────
    const drawLine = (y, color = '#e0e0e0', thickness = 0.5) => {
      doc.save().strokeColor(color).lineWidth(thickness)
        .moveTo(margin, y).lineTo(W - margin, y).stroke().restore();
    };

    const amountStr = (n) => `₹ ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // ════════════════════════════════════════════════════════════
    // MODERN TEMPLATE
    // ════════════════════════════════════════════════════════════
    if (template === 'MODERN') {
      // Header gradient bar
      doc.save().rect(0, 0, W, 110).fill('#1a1a2e').restore();
      doc.save().rect(0, 100, W, 12).fill('#e8734a').restore();

      // Store name in header
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text(storeName.toUpperCase(), margin, 22, { width: contentW, align: 'center' });
      
      if (headerText) {
        doc.fontSize(11).font('Helvetica').fillColor('#f0c080');
        doc.text(headerText, margin, 50, { width: contentW, align: 'center' });
      }
      
      // Contact line
      const contactParts = [storeAddress, storeContact, storeEmail].filter(Boolean);
      if (contactParts.length) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#aaaacc');
        doc.text(contactParts.join('  |  '), margin, headerText ? 68 : 55, { width: contentW, align: 'center' });
      }

      // Receipt title pill
      doc.save().roundedRect(W/2 - 70, 113, 140, 24, 12).fill('#e8734a').restore();
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
        .text('DONATION RECEIPT', W/2 - 70, 118, { width: 140, align: 'center' });

      let y = 155;
      
      // Receipt No + Date row
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555');
      doc.text('Receipt No', margin, y); doc.text('Date', W/2 + 10, y);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e');
      doc.text(receipt.receipt_number, margin, y + 13);
      doc.text(new Date(receipt.receipt_date || receipt.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }), W/2 + 10, y + 13);
      
      y += 38;
      drawLine(y);
      y += 12;

      // Customer info box
      doc.save().rect(margin, y, contentW, 58).fill('#f8f9ff').restore();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#888').text('DONOR DETAILS', margin + 12, y + 8);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a2e').text(receipt.customer_name, margin + 12, y + 20);
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      doc.text(`Mobile: ${receipt.customer_mobile || '-'}`, margin + 12, y + 36);
      doc.text(`A/c No: ${receipt.account_number || '-'}`, W/2, y + 36);
      doc.text(`Mode: ${receipt.payment_mode || 'N/A'}`, W/2, y + 36 + 13);
      
      y += 70;

      // Particulars header
      doc.save().rect(margin, y, contentW, 22).fill('#1a1a2e').restore();
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('PARTICULAR', margin + 10, y + 7);
      doc.text('AMOUNT', W - margin - 120, y + 7, { width: 55, align: 'right' });
      doc.text('PAID', W - margin - 55, y + 7, { width: 50, align: 'right' });
      y += 22;

      // Particulars rows
      const particulars = receipt.particulars || [];
      particulars.forEach((p, i) => {
        if (i % 2 === 0) {
          doc.save().rect(margin, y, contentW, 20).fill('#fafafa').restore();
        }
        doc.fontSize(9.5).font('Helvetica').fillColor('#222');
        doc.text(p.particular_name, margin + 10, y + 6);
        doc.text(amountStr(p.amount), W - margin - 120, y + 6, { width: 55, align: 'right' });
        const paid = p.paid_amount ?? p.amount;
        doc.fillColor(Number(paid) < Number(p.amount) ? '#c05000' : '#222');
        doc.text(amountStr(paid), W - margin - 55, y + 6, { width: 50, align: 'right' });
        y += 20;
      });

      drawLine(y, '#cccccc', 1);
      y += 10;

      // Totals
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e');
      doc.text('TOTAL', margin + 10, y);
      doc.text(amountStr(receipt.total_amount), W - margin - 120, y, { width: 55, align: 'right' });
      
      if (receipt.status === 'PARTIAL') {
        y += 18;
        const due = Number(receipt.total_amount) - Number(receipt.paid_amount || 0);
        doc.fontSize(9.5).font('Helvetica').fillColor('#555');
        doc.text(`Paid: ${amountStr(receipt.paid_amount || 0)}`, W - margin - 175, y, { width: 170, align: 'right' });
        y += 14;
        doc.fillColor('#c05000').font('Helvetica-Bold');
        doc.text(`Balance Due: ${amountStr(due)}`, W - margin - 175, y, { width: 170, align: 'right' });
      }

      y += 35;

      // Footer
      doc.save().rect(0, y, W, 1).fill('#e8734a').restore();
      y += 10;
      doc.fontSize(8).font('Helvetica').fillColor('#888').text(`Status: ${receipt.receipt_state}`, margin, y);
      doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin, y, { width: contentW, align: 'right' });
      y += 14;
      doc.fontSize(7.5).fillColor('#aaa').text('This is a computer generated receipt and does not require a physical signature.', margin, y, { width: contentW, align: 'center' });

    // ════════════════════════════════════════════════════════════
    // TRADITIONAL TEMPLATE
    // ════════════════════════════════════════════════════════════
    } else if (template === 'TRADITIONAL') {
      // Outer decorative border
      doc.save().rect(20, 20, W - 40, 800).stroke('#8B4513').lineWidth(2).stroke().restore();
      doc.save().rect(26, 26, W - 52, 788).stroke('#DAA520').lineWidth(0.5).stroke().restore();

      let y = 45;
      
      // Custom header text or default
      const displayHeader = headerText || '🙏  Donation Receipt  🙏';
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#8B4513')
        .text(displayHeader, margin, y, { width: contentW, align: 'center' });
      y += 22;

      // Store name
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text(storeName, margin, y, { width: contentW, align: 'center' });
      y += 26;

      // Contact
      const contactParts = [storeAddress, storeContact, storeEmail].filter(Boolean);
      if (contactParts.length) {
        doc.fontSize(9).font('Helvetica').fillColor('#555')
          .text(contactParts.join('  ·  '), margin, y, { width: contentW, align: 'center' });
        y += 16;
      }

      // Decorative divider
      doc.fontSize(12).fillColor('#DAA520').text('✦ ─────────────────────────────────── ✦', margin, y, { width: contentW, align: 'center' });
      y += 20;

      // Receipt number and date
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#8B4513');
      doc.text(`Receipt No: ${receipt.receipt_number}`, margin + 10, y);
      doc.text(`Date: ${new Date(receipt.receipt_date || receipt.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}`, W/2 + 10, y);
      y += 22;

      drawLine(y, '#DAA520', 0.8);
      y += 14;

      // Donor details
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('Donor Name:', margin + 10, y);
      doc.font('Helvetica').fillColor('#000').text(receipt.customer_name, margin + 100, y);
      y += 18;
      doc.font('Helvetica-Bold').fillColor('#333').text('Mobile:', margin + 10, y);
      doc.font('Helvetica').fillColor('#000').text(receipt.customer_mobile || '-', margin + 100, y);
      doc.font('Helvetica-Bold').fillColor('#333').text('Account No:', W/2 + 10, y);
      doc.font('Helvetica').fillColor('#000').text(receipt.account_number || '-', W/2 + 90, y);
      y += 18;
      doc.font('Helvetica-Bold').fillColor('#333').text('Payment Mode:', margin + 10, y);
      doc.font('Helvetica').fillColor('#000').text(receipt.payment_mode || '-', margin + 100, y);
      y += 22;

      drawLine(y, '#DAA520', 0.8);
      y += 12;

      // Particulars
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#8B4513');
      doc.text('Donation Particulars', margin + 10, y);
      doc.text('Amount (₹)', W - margin - 100, y, { width: 95, align: 'right' });
      y += 16;
      drawLine(y, '#DAA520', 0.5);
      y += 10;

      doc.font('Helvetica').fillColor('#000').fontSize(10);
      (receipt.particulars || []).forEach((p) => {
        doc.text(p.particular_name, margin + 10, y);
        const paid = p.paid_amount ?? p.amount;
        const isPart = Number(paid) < Number(p.amount);
        if (isPart) {
          doc.fillColor('#888').text(`${amountStr(p.amount)} (Paid: ${amountStr(paid)})`, W - margin - 180, y, { width: 175, align: 'right' });
        } else {
          doc.fillColor('#000').text(amountStr(p.amount), W - margin - 100, y, { width: 95, align: 'right' });
        }
        doc.fillColor('#000');
        y += 20;
      });

      drawLine(y, '#DAA520', 0.8);
      y += 12;

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e');
      doc.text('Total Amount:', margin + 10, y);
      doc.text(amountStr(receipt.total_amount), W - margin - 100, y, { width: 95, align: 'right' });

      if (receipt.status === 'PARTIAL') {
        y += 18;
        const due = Number(receipt.total_amount) - Number(receipt.paid_amount || 0);
        doc.fontSize(9).font('Helvetica').fillColor('#555');
        doc.text(`Paid: ${amountStr(receipt.paid_amount)}   Balance Due: ${amountStr(due)}`, margin + 10, y);
      }

      y += 35;
      drawLine(y, '#DAA520', 0.5);
      y += 12;
      doc.fontSize(8.5).font('Helvetica').fillColor('#888')
        .text(`Status: ${receipt.receipt_state}  |  Generated: ${new Date().toLocaleString('en-IN')}`, margin, y, { width: contentW, align: 'center' });
      y += 14;
      doc.fontSize(8).fillColor('#aaa')
        .text('This is a computer generated receipt.', margin, y, { width: contentW, align: 'center' });

    // ════════════════════════════════════════════════════════════
    // MINIMAL TEMPLATE
    // ════════════════════════════════════════════════════════════
    } else if (template === 'MINIMAL') {
      let y = margin;

      doc.fontSize(18).font('Helvetica-Bold').fillColor('#000')
        .text(storeName, margin, y, { width: contentW, align: 'left' });
      
      if (headerText) {
        y += 22;
        doc.fontSize(10).font('Helvetica').fillColor('#666')
          .text(headerText, margin, y);
      }

      const contactParts = [storeContact, storeEmail].filter(Boolean);
      if (contactParts.length) {
        y += 14;
        doc.fontSize(9).fillColor('#888').text(contactParts.join('  ·  '), margin, y);
      }

      y += 8;
      drawLine(y, '#000', 2);
      y += 14;

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('RECEIPT', margin, y);
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      doc.text(receipt.receipt_number, margin, y + 18);
      doc.text(new Date(receipt.receipt_date || receipt.created_at).toLocaleDateString('en-IN'), W - margin - 100, y, { width: 100, align: 'right' });

      y += 40;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(receipt.customer_name, margin, y);
      y += 15;
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      doc.text(`Mobile: ${receipt.customer_mobile || '-'}   A/c: ${receipt.account_number || '-'}   Mode: ${receipt.payment_mode || '-'}`, margin, y);
      y += 25;

      drawLine(y, '#ccc');
      y += 10;

      (receipt.particulars || []).forEach((p) => {
        doc.fontSize(9.5).font('Helvetica').fillColor('#000').text(p.particular_name, margin, y);
        doc.text(amountStr(p.paid_amount ?? p.amount), W - margin - 90, y, { width: 85, align: 'right' });
        y += 18;
      });

      drawLine(y, '#000', 1);
      y += 10;

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text('Total', margin, y);
      doc.text(amountStr(receipt.total_amount), W - margin - 90, y, { width: 85, align: 'right' });

      if (receipt.status === 'PARTIAL') {
        y += 16;
        const due = Number(receipt.total_amount) - Number(receipt.paid_amount || 0);
        doc.fontSize(9).font('Helvetica').fillColor('#555');
        doc.text(`Paid: ${amountStr(receipt.paid_amount || 0)}`, margin, y);
        doc.fillColor('#c05000').text(`Due: ${amountStr(due)}`, W - margin - 90, y, { width: 85, align: 'right' });
      }

      y += 35;
      drawLine(y, '#ccc');
      y += 10;
      doc.fontSize(8).font('Helvetica').fillColor('#aaa')
        .text(`${receipt.receipt_state}  ·  ${new Date().toLocaleString('en-IN')}`, margin, y, { width: contentW, align: 'center' });

    // ════════════════════════════════════════════════════════════
    // DEFAULT TEMPLATE (clean, professional, universal)
    // ════════════════════════════════════════════════════════════
    } else {
      let y = margin;

      // Header bar
      doc.save().rect(0, 0, W, 90).fill('#2563eb').restore();

      // Store name
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#fff')
        .text(storeName, margin, 18, { width: contentW, align: 'center' });
      
      if (headerText) {
        doc.fontSize(10).font('Helvetica').fillColor('#bfd7ff')
          .text(headerText, margin, 42, { width: contentW, align: 'center' });
      }

      const contactParts = [storeAddress, storeContact, storeEmail].filter(Boolean);
      if (contactParts.length) {
        doc.fontSize(8.5).fillColor('#93c5fd')
          .text(contactParts.join('  |  '), margin, headerText ? 58 : 46, { width: contentW, align: 'center' });
      }

      y = 105;

      // Receipt title
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e40af')
        .text('DONATION RECEIPT', margin, y, { width: contentW, align: 'center' });
      y += 25;

      // Meta row
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
      doc.text('Receipt No:', margin, y); doc.text('Date:', W/2, y);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#111');
      doc.text(receipt.receipt_number, margin, y + 13);
      doc.text(new Date(receipt.receipt_date || receipt.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }), W/2, y + 13);
      y += 35;

      drawLine(y, '#e5e7eb');
      y += 12;

      // Customer box
      doc.save().rect(margin, y, contentW, 54).fill('#f3f4f6').restore();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#6b7280').text('DONOR INFORMATION', margin + 12, y + 8);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text(receipt.customer_name, margin + 12, y + 20);
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      doc.text(`Mobile: ${receipt.customer_mobile || '-'}`, margin + 12, y + 36);
      doc.text(`A/c No: ${receipt.account_number || '-'}`, W/2, y + 36);
      doc.text(`Mode: ${receipt.payment_mode || '-'}`, margin + 12, y + 36);
      y += 68;

      // Table header
      doc.save().rect(margin, y, contentW, 22).fill('#2563eb').restore();
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff');
      doc.text('PARTICULAR', margin + 10, y + 7);
      doc.text('AMOUNT', W - margin - 100, y + 7, { width: 95, align: 'right' });
      y += 22;

      // Rows
      (receipt.particulars || []).forEach((p, i) => {
        if (i % 2 === 1) doc.save().rect(margin, y, contentW, 20).fill('#f9fafb').restore();
        doc.fontSize(9.5).font('Helvetica').fillColor('#111').text(p.particular_name, margin + 10, y + 6);
        const paid = p.paid_amount ?? p.amount;
        const isPart = Number(paid) < Number(p.amount);
        if (isPart) {
          doc.fillColor('#666').text(`${amountStr(p.amount)} (Paid: ${amountStr(paid)})`, W - margin - 165, y + 6, { width: 160, align: 'right' });
        } else {
          doc.fillColor('#111').text(amountStr(p.amount), W - margin - 100, y + 6, { width: 95, align: 'right' });
        }
        y += 20;
      });

      drawLine(y, '#e5e7eb');
      y += 12;

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e40af');
      doc.text('TOTAL', margin + 10, y);
      doc.text(amountStr(receipt.total_amount), W - margin - 100, y, { width: 95, align: 'right' });

      if (receipt.status === 'PARTIAL') {
        y += 18;
        const due = Number(receipt.total_amount) - Number(receipt.paid_amount || 0);
        doc.fontSize(9).font('Helvetica').fillColor('#555');
        doc.text(`Paid: ${amountStr(receipt.paid_amount || 0)}`, W - margin - 170, y, { width: 165, align: 'right' });
        y += 14;
        doc.fillColor('#dc2626').font('Helvetica-Bold').text(`Balance Due: ${amountStr(due)}`, W - margin - 170, y, { width: 165, align: 'right' });
      }

      y += 35;
      doc.save().rect(0, y, W, 30).fill('#f3f4f6').restore();
      doc.fontSize(8).font('Helvetica').fillColor('#888')
        .text(`Status: ${receipt.receipt_state}  |  Generated: ${new Date().toLocaleString('en-IN')}`, margin, y + 9, { width: contentW, align: 'center' });
      y += 30;
      doc.fontSize(7.5).fillColor('#bbb')
        .text('This is a computer generated receipt.', margin, y + 5, { width: contentW, align: 'center' });
    }

    doc.end();
  } catch (e) {
    console.error('PDF error:', e);
    error(res, e.message);
  }
};

// Direct PUT/DELETE not allowed — must use change_requests
const notAllowed = (req, res) =>
  res.status(405).json({ status: 'ERROR', DDMS_error_code: 'USE_CHANGE_REQUEST_ENDPOINT' });

module.exports = { getAll, getById, create, approve, reject, getPending, getByDateRange, stateChange, pay, collectRemaining, getApprovals, getPdf, notAllowed };
