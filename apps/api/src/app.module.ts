import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AccountsModule } from './accounts/accounts.module';
import { TradesModule } from './trades/trades.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CatalogModule } from './catalog/catalog.module';
import { ImportModule } from './import/import.module';
import { SyncModule } from './sync/sync.module';
import { MarketModule } from './market/market.module';

@Module({
  imports: [PrismaModule, AccountsModule, TradesModule, AnalyticsModule, CatalogModule, ImportModule, SyncModule, MarketModule],
  controllers: [AppController],
})
export class AppModule {}
