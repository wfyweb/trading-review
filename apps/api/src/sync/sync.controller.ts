import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('config')
  getConfig() {
    return this.sync.getConfig();
  }

  @Put('config')
  saveConfig(@Body() body: { apiKey?: string; secret?: string; passphrase?: string; baselineCapital?: string }) {
    return this.sync.saveConfig(body);
  }

  @Delete('config')
  clearConfig() {
    return this.sync.clearConfig();
  }

  @Post('test')
  @HttpCode(200)
  test(@Body() body?: { apiKey?: string; secret?: string; passphrase?: string }) {
    return this.sync.testConnection(body);
  }

  @Get('netcheck')
  netCheck() {
    return this.sync.netCheck();
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() body: { from?: string; to?: string; limit?: number }) {
    return this.sync.run(body);
  }

  @Get('jobs')
  list() {
    return this.sync.listJobs();
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    return this.sync.resetSyncData();
  }

  @Post('purge-all')
  @HttpCode(200)
  purgeAll() {
    return this.sync.purgeAllData();
  }

  @Get('jobs/:id')
  detail(@Param('id') id: string) {
    return this.sync.getJob(id);
  }
}
