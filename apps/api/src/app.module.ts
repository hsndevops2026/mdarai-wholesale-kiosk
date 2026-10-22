import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './core/throttler.guard';
import { AdminController } from './admin/admin.controller';
import { ImportService } from './admin/import.service';
import { TemplateService } from './admin/template.service';
import { KioskDeviceGuard, KioskSessionGuard, PrintAgentGuard, StaffGuard } from './auth/guards';
import { KioskAuthService } from './auth/kiosk-auth.service';
import { StaffAuthService } from './auth/staff-auth.service';
import { StaffController } from './auth/staff.controller';
import { AuditService } from './core/audit.service';
import { CatalogService } from './core/catalog.service';
import { APP_CONFIG, loadConfig } from './core/config';
import { EventsService } from './core/events.service';
import { HealthController } from './core/health.controller';
import { ParserService } from './core/parser.service';
import { PricingService } from './core/pricing.service';
import { PrismaService } from './core/prisma.service';
import { CartService } from './kiosk/cart.service';
import { KioskController } from './kiosk/kiosk.controller';
import { OrderService } from './orders/order.service';
import { PrintAgentController } from './printing/print-agent.controller';
import { PrintService } from './printing/print.service';
import { WarehouseController } from './warehouse/warehouse.controller';
import { WarehouseGateway } from './warehouse/warehouse.gateway';

const config = loadConfig();

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }])],
  controllers: [HealthController, KioskController, StaffController, WarehouseController, AdminController, PrintAgentController],
  providers: [
    { provide: APP_CONFIG, useValue: config },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    PrismaService,
    AuditService,
    EventsService,
    CatalogService,
    PricingService,
    ParserService,
    KioskAuthService,
    StaffAuthService,
    KioskDeviceGuard,
    KioskSessionGuard,
    StaffGuard,
    PrintAgentGuard,
    CartService,
    OrderService,
    WarehouseGateway,
    ImportService,
    TemplateService,
    PrintService,
  ],
})
export class AppModule {}
