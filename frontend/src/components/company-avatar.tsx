'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { api } from '@/lib/api';

/** Инициалы из названия: «ТОО «Астана Трейд»» → «АТ». Кавычки и форма собственности не нужны. */
function initials(name: string): string {
  const words = name
    .replace(/[«»"']/g, ' ')
    .split(/\s+/)
    .filter(
      (word) => word.length > 1 && !/^(ТОО|АО|ИП|ООО|LLP|LLC)$/i.test(word),
    );
  const source = words.length > 0 ? words : name.split(/\s+/);
  return source
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/** Цвет выводится из id, чтобы у компании он не менялся от захода к заходу. */
const PALETTE = [
  '#0f6f5c',
  '#2f5d8a',
  '#7a4b8f',
  '#8a5a2b',
  '#3f6b2f',
  '#8a3b52',
];
const colorFor = (id: string) =>
  PALETTE[
    [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length
  ];

const SIZES = {
  sm: 'size-10 text-sm',
  md: 'size-14 text-base',
  lg: 'size-20 text-xl',
};

export function CompanyAvatar({
  id,
  name,
  hasLogo,
  size = 'md',
  className,
}: {
  id: string;
  name: string;
  hasLogo?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Логотип мог быть удалён мимо интерфейса — тогда показываем инициалы.
  const [broken, setBroken] = useState(false);
  const showLogo = hasLogo && !broken;

  return (
    <div
      className={clsx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        SIZES[size],
        className,
      )}
      style={showLogo ? undefined : { backgroundColor: colorFor(id) }}
      aria-hidden
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- файл отдаёт наш API, оптимизация Next тут не нужна
        <img
          src={api.borrowers.logoUrl(id)}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name)
      )}
    </div>
  );
}
