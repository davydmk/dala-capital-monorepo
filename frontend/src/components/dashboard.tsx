/** Заглушка дашборда: показатели, шаги онбординга и лента событий. Одна на три роли. */
import { Inbox } from 'lucide-react';
import { Card, CardTitle, EmptyState, Notice, StatTile, Steps } from './ui';
import { ROLE_TITLE, type Role, type User } from '@/lib/types';

interface RoleContent {
  tiles: { label: string; hint: string }[];
  steps: string[];
  eventsHint: string;
}

const CONTENT: Record<Role, RoleContent> = {
  INVESTOR: {
    tiles: [
      { label: 'Вложено', hint: 'Сумма ваших взносов в активные займы' },
      { label: 'Получено', hint: 'Выплаченные тело и проценты' },
      { label: 'Ожидается', hint: 'Доступно к выводу прямо сейчас' },
      { label: 'Активных кампаний', hint: 'Займы, где у вас есть доля' },
    ],
    // Шаги проверки личности живут в своей карточке на дашборде инвестора:
    // там они показываются по настоящему состоянию анкеты, а не текстом.
    steps: [
      'Выбрать кампанию',
      'Пополнить личный адрес кампании',
      'Дождаться закрытия сбора',
      'Получать выплаты по графику',
    ],
    eventsHint:
      'Здесь появятся зачисления взносов, выплаты и изменения по вашим кампаниям.',
  },
  BORROWER: {
    tiles: [
      { label: 'Следующий платёж', hint: 'Сумма по графику' },
      { label: 'Дата платежа', hint: 'Ближайшая дата из графика' },
      { label: 'Остаток долга', hint: 'Непогашенное тело займа' },
      { label: 'Просрочка', hint: 'Дни и сумма, если платёж пропущен' },
    ],
    steps: [
      'Проверить данные компании',
      'Указать кошелёк для получения займа',
      'Дождаться завершения сбора',
      'Платить по графику',
    ],
    eventsHint:
      'Здесь появятся поступления по вашему займу и напоминания о платежах.',
  },
  ADMIN: {
    tiles: [
      { label: 'Кампаний в сборе', hint: 'Идёт приём взносов' },
      { label: 'Собрано за месяц', hint: 'Закрытые сборы за 30 дней' },
      { label: 'Просрочек', hint: 'Займы с пропущенным платежом' },
      { label: 'Заявок на проверку', hint: 'Инвесторы ждут одобрения' },
    ],
    steps: [
      'Разрешить токен платформы',
      'Добавить заёмщика',
      'Создать кампанию и загрузить график',
      'Закрыть сбор после подтверждения кошелька',
    ],
    eventsHint:
      'Здесь появятся операции платформы: сборы, поступления, выплаты и дефолты.',
  },
};

export function Dashboard({ user }: { user: User }) {
  const content = CONTENT[user.role];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold sm:text-2xl">
          Здравствуйте, {user.name}
        </h2>
        <p className="text-sm text-muted">Кабинет · {ROLE_TITLE[user.role]}</p>
      </div>

      {/* Инвестору состояние проверки показывает своя карточка — с настоящими шагами. */}
      {user.status === 'PENDING' && user.role !== 'INVESTOR' ? (
        <Notice tone="warning" title="Профиль на проверке">
          Обычно проверка занимает один рабочий день. Операции станут доступны
          после одобрения.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {content.tiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value="—"
            hint={tile.hint}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Следующие шаги</CardTitle>
          <Steps items={content.steps.map((title) => ({ title }))} />
        </Card>
        <Card>
          <CardTitle>Последние события</CardTitle>
          <EmptyState
            icon={<Inbox size={28} aria-hidden />}
            title="Событий пока нет"
          >
            {content.eventsHint}
          </EmptyState>
        </Card>
      </div>
    </div>
  );
}
