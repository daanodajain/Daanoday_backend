const svc = require('../services/auditLogService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try {
    const filters = {
      action:     req.query.action     || null,
      entityType: req.query.entityType || null,
      startDate:  req.query.startDate  || null,
      endDate:    req.query.endDate    || null,
    };
    success(res, await svc.getAll(req.storeId, filters, req.query.limit ? Number(req.query.limit) : 200));
  } catch (e) { error(res, e.message); }
};

const getByEntity = async (req, res) => {
  try { success(res, await svc.getByEntity(req.storeId, req.params.entityName, req.params.entityId)); }
  catch (e) { error(res, e.message); }
};

const exportXlsx = async (req, res) => {
  try {
    const filters = {
      action:     req.query.action     || null,
      entityType: req.query.entityType || null,
      startDate:  req.query.startDate  || null,
      endDate:    req.query.endDate    || null,
    };
    const buffer = await svc.exportAsXlsx(req.storeId, filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

module.exports = { getAll, getByEntity, exportXlsx };
