import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns/propagates `X-Request-Id` and emits one structured log line per request. */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { id?: string; user?: { id: string } }, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    req.id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const entry = {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: req.user?.id ?? null,
      };
      if (res.statusCode >= 500) this.logger.error(entry);
      else if (res.statusCode >= 400) this.logger.warn(entry);
      else this.logger.log(entry);
    });
    next();
  }
}
