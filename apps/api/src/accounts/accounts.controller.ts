import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; baselineCapital?: string; posMode?: string },
  ) {
    return this.accounts.update(id, body);
  }

  @Get(':id/derive-baseline')
  derive(@Param('id') id: string) {
    return this.accounts.deriveBaseline(id);
  }

  @Post(':id/derive-baseline')
  @HttpCode(200)
  async applyDerived(@Param('id') id: string) {
    const r = await this.accounts.deriveBaseline(id);
    const acc = await this.accounts.update(id, { baselineCapital: r.suggestedBaseline });
    return { ...r, applied: true, baselineCapital: acc.baselineCapital };
  }
}
