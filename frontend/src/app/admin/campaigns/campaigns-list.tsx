'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CompanyAvatar } from '@/components/company-avatar';
import { bpsToPercent, formatDateTime, formatMoney } from '@/components/money';
import {
  Button,
  buttonStyles,
  Card,
  Chip,
  EmptyState,
  Field,
  Notice,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { words } from '@/lib/wording';
import {
  CAMPAIGN_STATE_TITLE,
  SCHEDULE_KIND_SHORT,
  type Campaign,
  type CampaignListItem,
  type ScheduleKind,
  type CampaignState,
} from '@/lib/types';

/** За сутки до конца сбора пора готовиться его закрывать: это делает оператор вручную. */
const DEADLINE_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Напоминание о закрытии сбора. Привязано к состоянию займа в сети, а не к
 * одной лишь дате: у давно закрытого и погашенного займа дедлайн тоже
 * в прошлом, и закрывать там давно нечего.
 */
function deadlineNote(campaign: CampaignListItem): string | null {
  if (campaign.state !== 'PUBLISHED' || !campaign.fundingDeadline) return null;
  if (campaign.status !== 'FUNDING' && campaign.status !== 'FUNDING_ENDED') {
    return null;
  }
  const w = words(campaign.scheduleKind);
  const left = new Date(campaign.fundingDeadline).getTime() - Date.now();
  if (left <= 0) return w.closeDue;
  if (left <= DEADLINE_SOON_MS) {
    return campaign.scheduleKind === 'COUPON'
      ? 'размещение скоро закончится'
      : 'сбор скоро закончится';
  }
  return null;
}

/** Вид вложения и состояние займа: ими же список и фильтруется. */
type Kind = 'all' | ScheduleKind;
type State = 'all' | 'DRAFT' | 'PUBLISHED';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'ANNUITY', label: 'Кредиты' },
  { value: 'COUPON', label: 'Облигации' },
];

const STATES: { value: State; label: string }[] = [
  { value: 'all', label: 'Любое состояние' },
  { value: 'DRAFT', label: 'Черновики' },
  { value: 'PUBLISHED', label: 'Опубликованные' },
];

const STATE_STYLE: Record<CampaignState, string> = {
  DRAFT: 'border-border text-muted',
  PUBLISHING: 'border-transparent bg-warning-soft text-warning',
  PUBLISHED: 'border-transparent bg-accent-soft text-accent',
  FAILED: 'border-transparent bg-danger-soft text-danger',
};

export function CampaignsList() {
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  const [state, setState] = useState<State>('all');
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.campaigns.list(),
  });

  const shown = campaigns.data?.filter(
    (campaign) =>
      (kind === 'all' || campaign.scheduleKind === kind) &&
      // «Опубликованные» — это и те, что сейчас публикуются или сорвались:
      // в списке их место рядом, а не в черновиках.
      (state === 'all' || (state === 'DRAFT') === (campaign.state === 'DRAFT')),
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating((open) => !open)}>
          <Plus size={18} aria-hidden /> Новая кампания
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((item) => (
          <Chip
            key={item.value}
            active={kind === item.value}
            onClick={() => setKind(item.value)}
          >
            {item.label}
          </Chip>
        ))}
        <span className="w-px bg-border" />
        {STATES.map((item) => (
          <Chip
            key={item.value}
            active={state === item.value}
            onClick={() => setState(item.value)}
          >
            {item.label}
          </Chip>
        ))}
      </div>

      {creating ? <NewCampaign onCancel={() => setCreating(false)} /> : null}

      {campaigns.isError ? (
        <Notice tone="danger" title="Не удалось загрузить кампании" />
      ) : null}
      {campaigns.isPending ? (
        <p className="text-sm text-muted">Загружаем…</p>
      ) : null}

      {shown?.length === 0 && !creating ? (
        <EmptyState
          icon={<Briefcase size={28} aria-hidden />}
          title="Кампаний пока нет"
        >
          Кампания собирает деньги инвесторов и выдаёт заём. Черновик можно
          заполнять в несколько заходов, публикация в контракт — последним
          шагом.
        </EmptyState>
      ) : null}

      <ul className="space-y-2">
        {shown?.map((campaign) => (
          <li key={campaign.id}>
            <Link
              href={`/admin/campaigns/${campaign.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-accent"
            >
              <CompanyAvatar
                id={campaign.borrower.id}
                name={campaign.borrower.name}
                hasLogo={Boolean(campaign.borrower.logoKey)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{campaign.title}</p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {campaign.borrower.name}
                  {campaign.annualRateBps
                    ? ` · ${bpsToPercent(campaign.annualRateBps)}% годовых`
                    : ''}
                  {campaign.periodCount
                    ? ` · ${campaign.periodCount} платежей`
                    : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium ${STATE_STYLE[campaign.state]}`}
                  >
                    {CAMPAIGN_STATE_TITLE[campaign.state]}
                  </span>
                  {campaign.hardCap ? (
                    <span className="text-muted">
                      до {formatMoney(campaign.hardCap)}
                    </span>
                  ) : null}
                  {campaign.onchainId ? (
                    <span className="text-muted">№{campaign.onchainId}</span>
                  ) : null}
                  <span className="text-muted">
                    {SCHEDULE_KIND_SHORT[campaign.scheduleKind]}
                  </span>
                  {campaign.fundingDeadline ? (
                    <span className="text-muted">
                      {words(campaign.scheduleKind).deadline.toLowerCase()}{' '}
                      {formatDateTime(campaign.fundingDeadline)}
                    </span>
                  ) : null}
                  {deadlineNote(campaign) ? (
                    <span className="text-warning">
                      {deadlineNote(campaign)}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Создание черновика: нужны только заёмщик и название, остальное — в мастере. */
function NewCampaign({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [borrowerId, setBorrowerId] = useState('');

  // В кампанию можно брать только допущенных заёмщиков.
  const borrowers = useQuery({
    queryKey: ['borrowers', 'approved'],
    queryFn: () => api.borrowers.list({ status: 'APPROVED' }),
  });

  const create = useMutation<
    Campaign,
    ApiError,
    { borrowerId: string; title: string }
  >({
    mutationFn: api.campaigns.create,
    onSuccess: async (campaign) => {
      await client.invalidateQueries({ queryKey: ['campaigns'] });
      router.push(`/admin/campaigns/${campaign.id}`);
    },
  });

  return (
    <Card>
      {borrowers.data?.length === 0 ? (
        <Notice tone="warning" title="Нет допущенных заёмщиков">
          Сначала заведите карточку компании, добавьте кошелёк и переведите её в
          статус «Допущен».
          <Link
            href="/admin/borrowers"
            className="ml-1 font-medium text-accent"
          >
            К заёмщикам
          </Link>
        </Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Заёмщик</span>
            <select
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3"
              value={borrowerId}
              onChange={(event) => setBorrowerId(event.target.value)}
            >
              <option value="">Выберите компанию</option>
              {borrowers.data?.map((borrower) => (
                <option key={borrower.id} value={borrower.id}>
                  {borrower.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Название кампании"
            placeholder="Оборотный заём на закуп товара"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      )}

      {create.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={create.error.message} />
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <Button
          loading={create.isPending}
          disabled={!borrowerId || title.trim().length < 2}
          onClick={() => create.mutate({ borrowerId, title: title.trim() })}
        >
          Создать черновик
        </Button>
        <button onClick={onCancel} className={buttonStyles('ghost')}>
          Отмена
        </button>
      </div>
    </Card>
  );
}
