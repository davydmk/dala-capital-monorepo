import type { Metadata } from 'next';
import { AcceptInvite } from './accept-invite';

export const metadata: Metadata = { title: 'Доступ в кабинет — Dala Capital' };

/** Приглашение открывают без входа, поэтому страница вне кабинетов. */
export default async function Page({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  return (
    <div className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold">Dala Capital</p>
        <AcceptInvite token={token} />
      </div>
    </div>
  );
}
