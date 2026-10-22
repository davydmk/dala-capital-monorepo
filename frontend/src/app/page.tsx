import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonStyles } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Dala Capital — частное кредитование и облигации на Solana',
  description:
    'Обслуживание токенизированной облигации: дата фиксации, реестр держателей, расчёт прав, купон и погашение',
};

const REPO = 'https://github.com/davydmk/dala-capital-monorepo';

/**
 * Титульная страница для тех, кто пришёл без доступов. Раньше корень вёл
 * прямо на вход, и человек со стороны видел форму логина без единого слова
 * о том, куда он попал. Вошедших по-прежнему перехватывает proxy.ts и уводит
 * в их кабинет.
 */
export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-12">
      <p className="text-sm text-muted">Dala Capital · devnet</p>
      <h1 className="mt-2 text-3xl font-semibold">
        Облигация живёт дольше, чем длится её выпуск
      </h1>
      <p className="mt-4 text-muted">
        Платформа частного кредитования на Solana: казахстанский бизнес
        занимает в USDC у иностранных инвесторов, которые ни разу не подключают
        кошелёк. Поверх займа выпускается именная облигация, и всё, что
        начинается после размещения, — дата фиксации, реестр держателей, расчёт
        причитающегося, купон, голосование и погашение — ведёт смарт-контракт.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/verify" className={buttonStyles('primary')}>
          Проверить выпуск — без входа
        </Link>
        <a
          href={`${REPO}#watch-it-work`}
          target="_blank"
          rel="noreferrer"
          className={buttonStyles('secondary')}
        >
          Посмотреть записи
        </a>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className={buttonStyles('secondary')}
        >
          Код и документация
        </a>
      </div>

      <p className="mt-8 text-sm text-muted">
        Есть доступы — <Link href="/login" className="text-accent hover:underline">войдите в кабинет</Link>.
        Логины для жюри лежат в README репозитория.
      </p>
    </div>
  );
}
