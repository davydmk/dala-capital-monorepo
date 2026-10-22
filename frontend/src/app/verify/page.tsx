import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyView } from './verify-view';

export const metadata: Metadata = {
  title: 'Проверка выпуска — Dala Capital',
  description:
    'Корпоративные действия по выпуску, список держателей и проверка отпечатка реестра — без входа',
};

/**
 * Страница проверки открыта всем: сессия здесь не спрашивается. Публикуется
 * ровно то, что покрыто отпечатком реестра, — имён в нём нет.
 */
export default function Page() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          Dala Capital
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Проверка выпуска</h1>
        <p className="mt-2 text-sm text-muted">
          Корпоративные действия по облигации, список держателей на дату
          фиксации и отпечаток этого списка, записанный в сети. Отпечаток можно
          пересчитать прямо здесь, в браузере, и сравнить с тем, что лежит в
          Solana. Вход не нужен.
        </p>
      </header>
      <VerifyView />
    </div>
  );
}
