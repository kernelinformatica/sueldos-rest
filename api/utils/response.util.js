export function sendError(res, status, message, error = null, meta = null) {
  const payload = { message };
  if (error !== undefined) payload.error = error;
  if (meta !== undefined && meta !== null) payload.meta = meta;
  return res.status(status).json(payload);
}

export function sendOk(res, data) {
  return res.json(data);
}
