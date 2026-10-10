'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BorrowerForm } from '@/components/borrower-form';
import { api, ApiError } from '@/lib/api';
import type { BorrowerInput, BorrowerSaveResult } from '@/lib/types';

export function NewBorrower() {
  const router = useRouter();

  const create = useMutation<BorrowerSaveResult, ApiError, BorrowerInput>({
    mutationFn: api.borrowers.create,
    onSuccess: ({ borrower }) =>
      router.replace(`/admin/borrowers/${borrower.id}`),
  });

  return (
    <div className="space-y-4">
      <Link
        href="/admin/borrowers"
        className="inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden /> К списку
      </Link>
      <p className="text-sm text-muted">
        Карточка создаётся черновиком. Допустить её к кампаниям можно после
        того, как заполнены название, БИН и кошелёк.
      </p>
      <BorrowerForm
        submitLabel="Создать карточку"
        pending={create.isPending}
        error={create.error?.message}
        onSubmit={(values) => create.mutate(values)}
      />
    </div>
  );
}
