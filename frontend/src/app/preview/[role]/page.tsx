import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Dashboard } from '@/components/dashboard';
import { Notice } from '@/components/ui';
import type { Role, User } from '@/lib/types';

/**
 * Предпросмотр каркаса без входа: /preview/investor, /preview/borrower, /preview/admin.
 * Нужен, чтобы смотреть вёрстку, в том числе с телефона. В боевой сборке недоступен.
 */
/** Общее для всех выдуманных пользователей: даты в предпросмотре не важны. */
const DEMO_DATES = {
  createdAt: '2026-09-01T10:00:00.000Z',
  previousLoginAt: null,
};

const DEMO: Record<string, User> = {
  investor: {
    ...DEMO_DATES,
    id: 'demo',
    email: 'investor@example.com',
    name: 'Иван Инвесторов',
    role: 'INVESTOR' as Role,
    status: 'PENDING',
  },
  borrower: {
    ...DEMO_DATES,
    id: 'demo',
    email: 'borrower@example.com',
    name: 'ТОО «Астана Трейд»',
    role: 'BORROWER' as Role,
    status: 'ACTIVE',
  },
  admin: {
    ...DEMO_DATES,
    id: 'demo',
    email: 'admin@example.com',
    name: 'Администратор',
    role: 'ADMIN' as Role,
    status: 'ACTIVE',
  },
};

export function generateStaticParams() {
  return Object.keys(DEMO).map((role) => ({ role }));
}

export default async function PreviewPage({
  params,
}: PageProps<'/preview/[role]'>) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { role } = await params;
  const user = DEMO[role];
  if (!user) notFound();

  return (
    <AppShell user={user} title="Дашборд">
      <div className="space-y-4">
        <Notice title="Предпросмотр без входа">
          Данные выдуманные, кнопки ничего не делают. Роли: /preview/investor,
          /preview/borrower, /preview/admin.
        </Notice>
        <Dashboard user={user} />
      </div>
    </AppShell>
  );
}
