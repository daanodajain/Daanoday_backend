// Supports both: success(res, data) and res.json(success(data)) patterns
const success = (res, data, status = 200) => {
  if (res && typeof res.status === 'function') {
    return res.status(status).json({ status: 'SUCCESS', DDMS_data: data });
  }
  // Called as success(data) — return object for res.json()
  return { status: 'SUCCESS', DDMS_data: res };
};

const error = (res, message, statusCode = 400) =>
  res.status(statusCode).json({ status: 'ERROR', DDMS_error_code: message });

module.exports = { success, error };
