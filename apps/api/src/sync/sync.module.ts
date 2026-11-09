import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SecretsService } from '../secrets/secrets.service';
import { MatchingService } from '../matching/matching.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [SyncController],
  providers: [SyncService, SecretsService, MatchingService],
  exports: [MatchingService, SecretsService],
})
export class SyncModule {}
