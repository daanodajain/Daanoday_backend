// Unique per process-start marker. If two consecutive requests show a
// DIFFERENT _bootId, more than one server process is live at once
// (e.g. an old instance that never restarted still serving some requests).
const BOOT_ID = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;

// Supports both: success(res, data) and res.json(success(data)) patterns
const success = (res, data, status = 200) => {
  if (res && typeof res.status === 'function') {
    return res.status(status).json({ status: 'SUCCESS', DDMS_data: data, _bootId: BOOT_ID });
  }
  // Called as success(data) — return object for res.json()
  return { status: 'SUCCESS', DDMS_data: res, _bootId: BOOT_ID };
};

const error = (res, message, statusCode = 400) =>
  res.status(statusCode).json({ status: 'ERROR', DDMS_error_code: message, _bootId: BOOT_ID });

module.exports = { success, error };
