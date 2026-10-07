export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = '需要编辑权限') => new AppError(401, 'UNAUTHORIZED', msg);
export const notFound = (msg = '资源不存在') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg, details);
