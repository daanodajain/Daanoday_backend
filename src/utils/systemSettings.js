const db = require('../config/db');

/**
 * Get a system setting value by key.
 * @param {string} key - setting_key in system_settings table
 * @param {string} defaultValue - fallback if key not found
 */
const getSetting = async (key, defaultValue = null) => {
  const [[row]] = await db.query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    [key]
  );
  return row ? row.setting_value : defaultValue;
};

/**
 * Returns true/false for boolean settings stored as 'true'/'false'.
 * @param {string} key
 * @param {boolean} defaultValue
 */
const getBoolSetting = async (key, defaultValue = false) => {
  const val = await getSetting(key, null);
  if (val === null) return defaultValue;
  return val === 'true';
};

module.exports = { getSetting, getBoolSetting };
