const db = require('../config/db');

// Normalize frontend fields (companyName/phone) to DB fields (name/mobile)
const normalize = (data) => ({
  name: data.name || data.companyName,
  mobile: data.mobile || data.phone || null,
  contact_person: data.contactPerson || data.contact_person || null,
  email: data.email || null,
  address: data.address || null,
});

const getAll = async (storeId) => {
  const [rows] = await db.query(
    'SELECT * FROM suppliers WHERE store_id = ? AND active = TRUE ORDER BY name',
    [storeId]
  );
  return rows.map(toFrontend);
};

const toFrontend = (row) => ({
  ...row,
  companyName: row.name,
  contactPerson: row.contact_person,
  phone: row.mobile,
});

const getById = async (id, storeId) => {
  const [[row]] = await db.query('SELECT * FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!row) throw new Error('SUPPLIER_NOT_FOUND');
  return toFrontend(row);
};

const create = async (data, storeId) => {
  const { name, mobile, contact_person, email, address } = normalize(data);
  if (!name) throw new Error('SUPPLIER_NAME_REQUIRED');
  const [result] = await db.query(
    'INSERT INTO suppliers (store_id, name, mobile, contact_person, email, address, active) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
    [storeId, name, mobile, contact_person, email, address]
  );
  return getById(result.insertId, storeId);
};

const update = async (id, storeId, data) => {
  const [[existing]] = await db.query('SELECT id FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('SUPPLIER_NOT_FOUND');
  const { name, mobile, contact_person, email, address } = normalize(data);
  await db.query(
    'UPDATE suppliers SET name = ?, mobile = ?, contact_person = ?, email = ?, address = ?, active = ? WHERE id = ?',
    [name, mobile, contact_person, email, address, data.active ?? true, id]
  );
  return getById(id, storeId);
};

const remove = async (id, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('SUPPLIER_NOT_FOUND');
  await db.query('UPDATE suppliers SET active = FALSE WHERE id = ?', [id]);
};

module.exports = { getAll, getById, create, update, remove };
