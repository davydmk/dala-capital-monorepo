'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardTitle, Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { isValidSolanaAddress } from '@/lib/validation';
import type { BorrowerWallet, WalletSaveResult } from '@/lib/types';

/**
 * Кошельки заёмщика: по разным кампаниям деньги могут уходить на разные адреса.
 * В мастере кампании подставляется помеченный «основной».
 */
export function WalletsBlock({
  id,
  wallets,
  onChange,
}: {
  id: string;
  wallets: BorrowerWallet[];
  onChange: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const add = useMutation<
    WalletSaveResult,
    ApiError,
    { label: string; address: string }
  >({
    mutationFn: (input) => api.borrowers.addWallet(id, input),
    onSuccess: async ({ check }) => {
      // Сеть могла не ответить — честно говорим, что адрес не проверен.
      setNote(check.ok === 'unknown' ? (check.reason ?? null) : null);
      setLabel('');
      setAddress('');
      await onChange();
    },
  });

  const setDefault = useMutation<unknown, ApiError, string>({
    mutationFn: (walletId) =>
      api.borrowers.updateWallet(id, walletId, { isDefault: true }),
    onSuccess: () => onChange(),
  });

  const remove = useMutation<void, ApiError, string>({
    mutationFn: (walletId) => api.borrowers.removeWallet(id, walletId),
    onSuccess: () => onChange(),
  });

  const addressLooksValid =
    address === '' || isValidSolanaAddress(address.trim());

  return (
    <Card>
      <CardTitle>Кошельки для получения займа</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Адресов может быть несколько: по каждой кампании выбирается один.
        Биржевой адрес с обязательным memo не подойдёт — деньги уйдут, но не
        зачислятся.
      </p>

      {wallets.length === 0 ? (
        <Notice tone="warning" title="Кошельков нет">
          Без адреса заёмщика нельзя допустить к кампаниям.
        </Notice>
      ) : (
        <ul className="space-y-2">
          {wallets.map((wallet) => (
            <li
              key={wallet.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <Wallet size={18} aria-hidden className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {wallet.label}
                  {wallet.isDefault ? (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                      основной
                    </span>
                  ) : null}
                </p>
                <p className="font-mono text-xs break-all text-muted">
                  {wallet.address}
                </p>
              </div>
              {!wallet.isDefault ? (
                <button
                  className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:text-accent"
                  onClick={() => setDefault.mutate(wallet.id)}
                >
                  <Check size={16} aria-hidden /> Сделать основным
                </button>
              ) : null}
              <button
                aria-label="Удалить кошелёк"
                className="flex size-11 items-center justify-center rounded-lg text-muted hover:text-danger"
                onClick={() => {
                  if (window.confirm(`Удалить адрес «${wallet.label}»?`))
                    remove.mutate(wallet.id);
                }}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {note ? (
        <div className="mt-3">
          <Notice tone="warning" title={note} />
        </div>
      ) : null}
      {add.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={add.error.message} />
        </div>
      ) : null}
      {remove.isError ? (
        <div className="mt-3">
          <Notice tone="danger" title={remove.error.message} />
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field
          label="Название"
          placeholder="Binance, основной"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Field
          label="Адрес Solana"
          className="font-mono"
          value={address}
          error={addressLooksValid ? undefined : 'Не похоже на адрес Solana'}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button
          variant="secondary"
          loading={add.isPending}
          disabled={!label.trim() || !address.trim() || !addressLooksValid}
          onClick={() =>
            add.mutate({ label: label.trim(), address: address.trim() })
          }
        >
          Добавить
        </Button>
      </div>
    </Card>
  );
}
