import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SessionPayload } from '../auth/auth.service.js';
import { CampaignsService } from './campaigns.service.js';
import {
  CreateCampaignDto,
  ListCampaignsDto,
  AmountDto,
  PreviewDto,
  SetWalletDto,
  UpdateCampaignDto,
} from './dto.js';
import { scheduleToCsv } from './schedule.js';

/** BigInt в JSON не сериализуется: суммы отдаём строками, чтобы не терять центы. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}

@Controller('campaigns')
@Roles(Role.ADMIN)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  async list(@Query() filter: ListCampaignsDto) {
    return serialize(await this.campaigns.list(filter));
  }

  @Post()
  async create(@Body() dto: CreateCampaignDto) {
    return serialize(await this.campaigns.create(dto));
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return serialize(await this.campaigns.get(id));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return serialize(await this.campaigns.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.campaigns.remove(id);
  }

  /** Считает график по сохранённым параметрам с учётом несохранённых правок. */
  @Post(':id/preview')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDto,
  ) {
    const campaign = await this.campaigns.get(id);
    return serialize(this.campaigns.preview(campaign, dto));
  }

  @Get(':id/checks')
  checks(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.checks(id);
  }

  @Get(':id/schedule.csv')
  async csv(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const campaign = await this.campaigns.get(id);
    const { max } = this.campaigns.preview(campaign);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${campaign.title}.csv`)}`,
    );
    response.send(scheduleToCsv(max));
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.campaigns.publish(id, session.sub));
  }

  @Get(':id/onchain')
  async onchain(@Param('id', ParseUUIDPipe) id: string) {
    return serialize(await this.campaigns.onchain(id));
  }

  /** Закрытие сбора: деньги уходят заёмщику или кампания становится несостоявшейся. */
  @Post(':id/close')
  @HttpCode(200)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.campaigns.close(id, session.sub));
  }

  /** Объявление дефолта: порог проверяем сами, чтобы отказ был понятным. */
  @Post(':id/default')
  @HttpCode(200)
  async markDefault(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.campaigns.markDefault(id, session.sub));
  }

  @Post(':id/recovery-cost')
  @HttpCode(200)
  async recoveryCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmountDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(
      await this.campaigns.recordRecoveryCost(
        id,
        BigInt(dto.amount),
        session.sub,
      ),
    );
  }

  /** Поступление по взысканному займу: в дефолте подписывает оператор. */
  @Post(':id/recovery-payment')
  @HttpCode(200)
  async recoveryPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.campaigns.recoveryPayment(id, session.sub));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(await this.campaigns.cancel(id, session.sub));
  }

  @Post(':id/borrower-wallet')
  @HttpCode(200)
  async setBorrowerWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWalletDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return serialize(
      await this.campaigns.setBorrowerWallet(id, dto.walletId, session.sub),
    );
  }
}
