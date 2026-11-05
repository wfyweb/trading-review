import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';

@Controller('strategies')
export class CatalogController {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  @Get()
  list() {
    return this.prisma.strategy.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Body() body: { name: string; description?: string; rules?: string }) {
    const acc = await this.accounts.ensureDefault();
    return this.prisma.strategy.create({
      data: { accountId: acc.id, name: body.name, description: body.description, rules: body.rules },
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; rules?: string; isActive?: boolean }) {
    return this.prisma.strategy.update({ where: { id }, data: body });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.trade.updateMany({ where: { strategyId: id }, data: { strategyId: null } });
    await this.prisma.strategy.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('tags')
export class TagsController {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  @Get()
  list() {
    return this.prisma.tag.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  @Post()
  async create(@Body() body: { name: string; category?: string; polarity?: string; color?: string }) {
    const acc = await this.accounts.ensureDefault();
    return this.prisma.tag.create({
      data: {
        accountId: acc.id,
        name: body.name,
        category: body.category ?? 'MISTAKE',
        polarity: body.polarity ?? 'NEGATIVE',
        color: body.color,
      },
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; category?: string; polarity?: string; color?: string }) {
    return this.prisma.tag.update({ where: { id }, data: body });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.tag.delete({ where: { id } });
    return { ok: true };
  }
}
