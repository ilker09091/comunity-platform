import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/common.dto.js';

export const BEARER_AUTH = 'access-token';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed (`VALIDATION_ERROR`) or malformed request',
  401: 'Missing, invalid or expired access token (`UNAUTHORIZED`, `INVALID_TOKEN`)',
  403: 'Not allowed (`FORBIDDEN`, `ACCOUNT_SUSPENDED`, `PRIVATE_ACCOUNT`, `BLOCKED`)',
  404: 'Resource not found or not visible to the viewer',
  409: 'Conflict with existing state',
  413: 'Uploaded file is too large (`FILE_TOO_LARGE`)',
  415: 'Unsupported media type (`UNSUPPORTED_MEDIA_TYPE`)',
  422: 'Request is valid but cannot be processed in the current state',
  429: 'Rate limit exceeded (`RATE_LIMITED`)',
};

/** Documents the standard error body for the given status codes. */
export function ApiErrors(...statuses: number[]) {
  return applyDecorators(
    ...[...new Set([...statuses, 429])].map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status] ?? HttpStatus[status], type: ErrorResponseDto }),
    ),
  );
}

/** Protected route: requires `Authorization: Bearer <accessToken>`. */
export function ApiAuth() {
  return applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiErrors(401));
}

/**
 * Public route that personalises the response when a bearer token is sent.
 * An invalid token still yields 401.
 */
export function ApiOptionalAuth() {
  return applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiResponse({ status: 401, description: 'A bearer token was supplied but is invalid or expired', type: ErrorResponseDto }));
}
