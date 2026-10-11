import { HttpStatus, ParseUUIDPipe, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, ErrorCode, ErrorDetail } from './app.exception.js';

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const message of Object.values(error.constraints ?? {})) {
      details.push({ field, message });
    }
    if (error.children?.length) details.push(...flatten(error.children, field));
  }
  return details;
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Validation failed', flatten(errors)),
  });
}

/** UUID path parameter pipe that returns the standard validation error body. */
export const UuidPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Validation failed', [
      { field: 'id', message: 'id must be a valid UUID' },
    ]),
});
