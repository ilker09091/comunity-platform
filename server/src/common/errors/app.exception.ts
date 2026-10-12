import { HttpException, HttpStatus } from '@nestjs/common';

/** Machine-readable error codes. Part of the frozen API contract. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_CURSOR: 'INVALID_CURSOR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  PRIVATE_ACCOUNT: 'PRIVATE_ACCOUNT',
  BLOCKED: 'BLOCKED',
  NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  POST_NOT_FOUND: 'POST_NOT_FOUND',
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_CONFLICT: 'ACCOUNT_CONFLICT',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  ALREADY_REPORTED: 'ALREADY_REPORTED',
  CANNOT_FOLLOW_SELF: 'CANNOT_FOLLOW_SELF',
  CANNOT_BLOCK_SELF: 'CANNOT_BLOCK_SELF',
  CANNOT_REPORT_SELF: 'CANNOT_REPORT_SELF',
  MAX_DEPTH_EXCEEDED: 'MAX_DEPTH_EXCEEDED',
  POST_NOT_REPOSTABLE: 'POST_NOT_REPOSTABLE',
  POST_NOT_EDITABLE: 'POST_NOT_EDITABLE',
  INVALID_MEDIA: 'INVALID_MEDIA',
  MEDIA_IN_USE: 'MEDIA_IN_USE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  INSUFFICIENT_RANK: 'INSUFFICIENT_RANK',
  LAST_SUPER_ADMIN: 'LAST_SUPER_ADMIN',
  INVALID_STATE: 'INVALID_STATE',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  READ_ONLY_MODE: 'READ_ONLY_MODE',
  IMPORTER_CONFIGURATION: 'IMPORTER_CONFIGURATION',
  IMPORTER_UNAVAILABLE: 'IMPORTER_UNAVAILABLE',
  IMPORTER_INVALID_RESPONSE: 'IMPORTER_INVALID_RESPONSE',
  IMPORTER_SOURCE_ERROR: 'IMPORTER_SOURCE_ERROR',
  TIKTOK_LOGIN_REQUIRED: 'TIKTOK_LOGIN_REQUIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super({ statusCode: status, code, message, details }, status);
  }

  static badRequest(code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    return new AppException(HttpStatus.BAD_REQUEST, code, message, details);
  }
  static unauthorized(code: ErrorCode = ErrorCode.UNAUTHORIZED, message = 'Authentication required') {
    return new AppException(HttpStatus.UNAUTHORIZED, code, message);
  }
  static forbidden(code: ErrorCode = ErrorCode.FORBIDDEN, message = 'You are not allowed to perform this action') {
    return new AppException(HttpStatus.FORBIDDEN, code, message);
  }
  static notFound(code: ErrorCode = ErrorCode.NOT_FOUND, message = 'Resource not found') {
    return new AppException(HttpStatus.NOT_FOUND, code, message);
  }
  static conflict(code: ErrorCode, message: string) {
    return new AppException(HttpStatus.CONFLICT, code, message);
  }
  static unprocessable(code: ErrorCode, message: string) {
    return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
  }
}
