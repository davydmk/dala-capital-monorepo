import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Вход — Dala Capital' };

export default function LoginPage() {
  // useSearchParams в форме требует границы Suspense, иначе страница не собирается статически.
  return (
    <Suspense
      fallback={<p className="text-center text-sm text-muted">Загрузка…</p>}
    >
      <LoginForm />
    </Suspense>
  );
}
