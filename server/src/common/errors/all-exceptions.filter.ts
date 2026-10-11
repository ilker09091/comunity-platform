import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppException, ErrorCode, ErrorDetail } from './app.exception.js';
import { recordServerError } from './recent-errors.js';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details: ErrorDetail[];
}

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.FILE_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  429: ErrorCode.RATE_LIMITED,
};

/** Converts every thrown error into the standard `{statusCode, code, message, details}` body. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      recordServerError({
        at: new Date().toISOString(),
        requestId: req.id ?? null,
        method: req.method,
        path: req.path,
        statusCode: body.statusCode,
        error: exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception),
      });
      this.logger.error(
        { message: 'Unhandled error', requestId: req.id, path: req.path, method: req.method },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests, please try again later',
        details: [],
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      let message = exception.message;
      if (typeof response === 'object' && response && 'message' in response) {
        const raw = (response as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join('; ') : String(raw);
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) message = 'File is too large';
      return {
        statusCode: status,
        code: STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST),
        message,
        details: [],
      };
    }
    // Postgres constraint violations that slipped through service-level checks.
    const pgCode = (exception as { code?: string; driverError?: { code?: string } })?.driverError?.code
      ?? (exception as { code?: string })?.code;
    if (pgCode === '23505') {
      return { statusCode: 409, code: ErrorCode.CONFLICT, message: 'Resource already exists', details: [] };
    }
    if (pgCode === '23503') {
      return { statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Related resource not found', details: [] };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
      details: [],
    };
  }
}
