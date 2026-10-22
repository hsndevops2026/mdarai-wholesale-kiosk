import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine-readable code and an Arabic message for the kiosk. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ code, message, ...extra }, status);
  }
}
