import { HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppError } from './errors';

/** Same limits as ThrottlerGuard, with an error the kiosk can show as-is. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'طلبات كثيرة بوقت قصير. استنى دقيقة وجرّب مرة ثانية');
  }
}
