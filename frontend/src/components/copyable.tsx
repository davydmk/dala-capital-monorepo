'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Адрес с кнопкой копирования: их постоянно нужно куда-то вставлять. */
export function Copyable({
  value,
  short = false,
}: {
  value: string;
  short?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="truncate font-mono text-xs" title={value}>
        {short ? `${value.slice(0, 6)}…${value.slice(-4)}` : value}
      </span>
      <button
        aria-label="Скопировать адрес"
        className="shrink-0 text-muted hover:text-accent"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          // Возвращаем обычный вид, чтобы кнопку можно было нажать снова.
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}
