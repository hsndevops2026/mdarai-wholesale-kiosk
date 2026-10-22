import { Body, Controller, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { PrintAgentGuard } from '../auth/guards';
import { ZodPipe } from '../core/zod.pipe';
import { PrintService } from './print.service';

const Agent = z.object({ agentId: z.string().trim().min(1).max(64) });
const Fail = Agent.extend({ error: z.string().max(2000) });

/** Endpoints for the in-store print agent (outbound polling, shared-secret auth). */
@Controller('print-agent/jobs')
@UseGuards(PrintAgentGuard)
@SkipThrottle()
export class PrintAgentController {
  constructor(private readonly print: PrintService) {}

  @Post('claim')
  async claim(@Body(new ZodPipe(Agent)) b: z.infer<typeof Agent>, @Res() res: Response) {
    const job = await this.print.claim(b.agentId);
    if (!job) return res.status(204).end();
    return res.status(200).json(job);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string, @Body(new ZodPipe(Agent)) b: z.infer<typeof Agent>) {
    return this.print.complete(id, b.agentId);
  }

  @Post(':id/fail')
  @HttpCode(200)
  fail(@Param('id') id: string, @Body(new ZodPipe(Fail)) b: z.infer<typeof Fail>) {
    return this.print.fail(id, b.agentId, b.error);
  }
}
