import { Module } from '@nestjs/common';
import { CatalogController, TagsController } from './catalog.controller';

@Module({
  controllers: [CatalogController, TagsController],
})
export class CatalogModule {}
