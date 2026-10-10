import type { ReactNode } from 'react';

/** Экраны до входа: одна колонка по центру, на телефоне во всю ширину. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold">Dala Capital</p>
        {children}
      </div>
    </div>
  );
}
