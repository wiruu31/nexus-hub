export class HttpError extends Error {
  constructor(status, code, message, { headers = {}, hint } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.hint = hint;
  }
}
