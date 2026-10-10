'use client';

/**
 * Каркас кабинета: общий для админа, заёмщика и инвестора.
 * Телефон — верхняя полоса с выездным меню и нижняя панель разделов.
 * Планшет и десктоп — постоянное меню слева.
 */
import clsx from 'clsx';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NAV_BY_ROLE, type NavItem } from './navigation';
import { tasksQuery } from './tasks-card';
import { ROLE_TITLE, type User } from '@/lib/types';

const isActive = (pathname: string, href: string, index: number) =>
  index === 0
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

function NavLinks({
  items,
  pathname,
  counts,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  /** Сколько задач ждёт на этом разделе; ноль — значка нет. */
  counts: Record<string, number>;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={
              isActive(pathname, item.href, index) ? 'page' : undefined
            }
            className={clsx(
              'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
              isActive(pathname, item.href, index)
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-background hover:text-foreground',
            )}
          >
            <Icon size={18} aria-hidden />
            {item.label}
            {counts[item.href] ? (
              <span className="ml-auto inline-flex min-w-5 justify-center rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning tabular-nums">
                {counts[item.href]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  user,
  title,
  onLogout,
  children,
}: {
  user: User;
  title: string;
  onLogout?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV_BY_ROLE[user.role];
  const bottomItems = items.filter((item) => item.primary).slice(0, 4);

  // Счётчики берутся из того же запроса, что и карточка на дашборде: два
  // источника разошлись бы, и значок в меню начал бы врать.
  const tasks = useQuery(tasksQuery);
  const counts: Record<string, number> = {};
  for (const task of tasks.data ?? []) {
    // Дашборд не считаем: он и так показывает всё целиком.
    const item = items.find(
      (nav) =>
        nav.href !== `/${user.role.toLowerCase()}` &&
        (task.href === nav.href || task.href.startsWith(`${nav.href}/`)),
    );
    if (item) counts[item.href] = (counts[item.href] ?? 0) + task.count;
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href={`/${user.role.toLowerCase()}`}
        className="px-3 text-lg font-semibold"
      >
        Dala Capital
      </Link>
      <NavLinks
        items={items}
        pathname={pathname}
        counts={counts}
        onNavigate={() => setMenuOpen(false)}
      />
      <div className="mt-auto rounded-lg border border-border p-3">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted">{ROLE_TITLE[user.role]}</p>
        <button
          onClick={onLogout}
          className="mt-2 flex min-h-11 items-center gap-2 text-sm text-muted hover:text-foreground"
        >
          <LogOut size={16} aria-hidden /> Выйти
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Меню на планшете и десктопе */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-surface md:block">
        {sidebar}
      </aside>

      {/* Выездное меню на телефоне */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Закрыть меню"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-border bg-surface">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <button
            className="-ml-2 flex size-11 items-center justify-center rounded-lg text-muted md:hidden"
            aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <button
            onClick={onLogout}
            aria-label="Выйти"
            className="ml-auto flex size-11 items-center justify-center rounded-lg text-muted md:hidden"
          >
            <LogOut size={20} />
          </button>
          <span className="ml-auto hidden text-sm text-muted md:block">
            {user.name} · {ROLE_TITLE[user.role]}
          </span>
        </header>

        {/* pb-24 на телефоне — место под нижнюю панель */}
        <main className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-24 sm:px-6 md:pb-10">
          {children}
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Основные разделы"
      >
        {bottomItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={
                isActive(pathname, item.href, index) ? 'page' : undefined
              }
              className={clsx(
                'flex min-h-14 flex-col items-center justify-center gap-1 text-[11px]',
                isActive(pathname, item.href, index)
                  ? 'text-accent'
                  : 'text-muted',
              )}
            >
              <Icon size={20} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Заглушка раздела, который ещё не сделан. */
export function SectionStub({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">
        {children ?? 'Раздел появится на следующих этапах.'}
      </p>
    </div>
  );
}
