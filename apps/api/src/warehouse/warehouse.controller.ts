import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { StaffUser } from '@mdarai/database';
import { ORDER_STATUSES, type OrderStatus } from '@mdarai/shared-types';
import { z } from 'zod';
import { CurrentStaff, Roles, StaffGuard } from '../auth/guards';
import { ZodPipe } from '../core/zod.pipe';
import { serializeOrder } from '../orders/order.serializer';
import { OrderService } from '../orders/order.service';

const StatusEnum = z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]);
const ListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : []))
    .pipe(z.array(StatusEnum)),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(50).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
const StatusBody = z.object({ status: StatusEnum });

@Controller('warehouse/orders')
@UseGuards(StaffGuard)
@Roles('WAREHOUSE', 'ADMIN')
export class WarehouseController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  async list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    const { total, rows } = await this.orders.list(q);
    return {
      total,
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        printStatus: o.printStatus,
        customer: o.customerSnapshot,
        total: o.total.toFixed(2),
        itemCount: o._count.items,
        createdAt: o.createdAt,
      })),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return serializeOrder(await this.orders.get(id));
  }

  @Post(':id/status')
  @HttpCode(200)
  async status(@Param('id') id: string, @Body(new ZodPipe(StatusBody)) b: z.infer<typeof StatusBody>, @CurrentStaff() staff: StaffUser) {
    return serializeOrder(await this.orders.setStatus(id, b.status, staff.id));
  }
}
