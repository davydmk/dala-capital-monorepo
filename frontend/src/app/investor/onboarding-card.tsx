'use client';

/** Состояние проверки на дашборде: что сделано и что делать дальше. */
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { buttonStyles, Card, CardTitle, Notice, Steps } from '@/components/ui';
import { api } from '@/lib/api';
import type { Investor } from '@/lib/types';

export function OnboardingCard() {
  const profile = useQuery({ queryKey: ['kyc'], queryFn: api.kyc.me });
  if (!profile.data) return null;

  const { investor, checks } = profile.data;
  const filled = checks.every((check) => check.ok);

  if (investor.status === 'APPROVED' && investor.onchainAccount) {
    return (
      <Notice tone="info" title="Проверка пройдена">
        Вы допущены к кампаниям платформы. Выплаты пойдут на указанный адрес
        вывода.
      </Notice>
    );
  }

  return (
    <Card>
      <CardTitle>Допуск к кампаниям</CardTitle>
      <p className="mb-3 text-sm text-muted">{hint(investor)}</p>
      <Steps
        items={[
          { title: 'Заполнить анкету', done: filled },
          {
            title: 'Приложить документы',
            done: checks.find((check) => check.key === 'documents')?.ok,
          },
          {
            title: 'Указать адрес для вывода средств',
            done: Boolean(investor.withdrawalAddress),
          },
          {
            title: 'Дождаться решения платформы',
            done: investor.status === 'APPROVED',
          },
        ]}
      />
      {investor.status === 'APPROVED' ? null : (
        <Link
          href="/investor/verification"
          className={buttonStyles('primary', 'mt-4')}
        >
          {investor.status === 'PENDING' ? 'Посмотреть анкету' : 'Продолжить'}{' '}
          <ArrowRight size={18} aria-hidden />
        </Link>
      )}
    </Card>
  );
}

function hint(investor: Investor): string {
  switch (investor.status) {
    case 'PENDING':
      return 'Анкета на проверке. Обычно это занимает один рабочий день.';
    case 'RETRY':
      return (
        investor.clientComment ??
        'Анкету вернули на доработку: исправьте и отправьте снова.'
      );
    case 'ON_HOLD':
      return 'Проверка отложена: нужны уточнения.';
    case 'REJECTED':
      return investor.clientComment ?? 'В доступе отказано.';
    case 'APPROVED':
      return 'Анкета одобрена, аккаунт в контракте создаётся.';
    default:
      return 'Чтобы вкладывать в кампании, пройдите проверку личности.';
  }
}
