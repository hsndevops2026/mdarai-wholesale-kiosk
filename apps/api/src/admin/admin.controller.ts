import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { hashToken, newToken, type StaffUser } from '@mdarai/database';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentStaff, Roles, StaffGuard } from '../auth/guards';
import { AuditService } from '../core/audit.service';
import { AppError } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { ZodPipe } from '../core/zod.pipe';
import { ImportService } from './import.service';
import { TemplateService } from './template.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DeviceSchema = z.object({ name: z.string().trim().min(1).max(60) });

@Controller('admin')
@UseGuards(StaffGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly imports: ImportService,
    private readonly templates: TemplateService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('import/preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async preview(@UploadedFile() file: Express.Multer.File | undefined, @CurrentStaff() staff: StaffUser) {
    if (!file) throw new AppError(HttpStatus.BAD_REQUEST, 'FILE_REQUIRED', 'اختر ملف xlsx أو csv');
    return this.imports.preview(file.buffer, file.originalname, staff.id);
  }

  @Post('import/:id/commit')
  @HttpCode(200)
  async commit(@Param('id') id: string, @CurrentStaff() staff: StaffUser) {
    return { summary: await this.imports.commit(id, staff.id) };
  }

  /** ?data=1 exports the current catalog in the same format, for edit-and-reimport. */
  @Get('import/template')
  async template(@Query('data') data: string | undefined, @Res() res: Response, @CurrentStaff() staff: StaffUser) {
    const withData = data === '1';
    const buf = await this.templates.build(withData);
    if (withData) await this.audit.log({ actorType: 'STAFF', actorId: staff.id, action: 'catalog.export' });
    res.setHeader('content-type', XLSX_MIME);
    res.setHeader('content-disposition', `attachment; filename="${withData ? 'MdarAi_Catalog_Export' : 'MdarAi_Wholesale_Import_Template'}.xlsx"`);
    res.send(buf);
  }

  @Get('kiosk-devices')
  async devices() {
    const rows = await this.prisma.client.kioskDevice.findMany({ orderBy: { createdAt: 'desc' } });
    return { devices: rows.map((d) => ({ id: d.id, name: d.name, active: d.active, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt })) };
  }

  /** The token is shown exactly once; only its hash is stored. */
  @Post('kiosk-devices')
  async createDevice(@Body(new ZodPipe(DeviceSchema)) b: z.infer<typeof DeviceSchema>, @CurrentStaff() staff: StaffUser) {
    const token = newToken();
    const d = await this.prisma.client.kioskDevice.create({ data: { name: b.name, tokenHash: hashToken(token) } });
    await this.audit.log({ actorType: 'STAFF', actorId: staff.id, action: 'kiosk_device.created', entityType: 'KioskDevice', entityId: d.id });
    return { id: d.id, name: d.name, token };
  }

  @Post('kiosk-devices/:id/deactivate')
  @HttpCode(200)
  async deactivate(@Param('id') id: string, @CurrentStaff() staff: StaffUser) {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.kioskDevice.update({ where: { id }, data: { active: false } });
      await tx.kioskSession.updateMany({ where: { deviceId: id, endedAt: null }, data: { endedAt: new Date(), endReason: 'device_deactivated' } });
    });
    await this.audit.log({ actorType: 'STAFF', actorId: staff.id, action: 'kiosk_device.deactivated', entityType: 'KioskDevice', entityId: id });
    return { ok: true };
  }
}
