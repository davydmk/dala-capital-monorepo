'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { timeLeft } from './campaign-bits';
import { formatDateTime } from './money';
import { Card, CardTitle } from './ui';
import { api } from '@/lib/api';
import type { Task } from '@/lib/types';

const DOT: Record<Task['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-accent',
};

/** Один запрос на карточку и на счётчики в меню: иначе они разойдутся. */
export const tasksQuery = {
  queryKey: ['tasks'] as const,
  queryFn: api.tasks.list,
};

/**
 * Что требует внимания. Не лента событий: лента копится и требует отметки
 * «прочитано», а задача появляется сама, когда условие наступило, и исчезает,
 * когда дело сделано. Поэтому у строки нет ни крестика, ни «понятно».
 */
export function TasksCard() {
  const tasks = useQuery(tasksQuery);

  // Пока не загрузилось или ничего не ждёт — места не занимаем. Пустая
  // карточка «всё хорошо» на дашборде только отодвигает всё остальное.
  if (!tasks.data?.length) return null;

  return (
    <Card>
      <CardTitle>Требует внимания</CardTitle>
      <ul className="-mx-2 space-y-1">
        {tasks.data.map((task) => (
          <li key={task.key}>
            <Link
              href={task.href}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-background"
            >
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${DOT[task.tone]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{task.title}</span>
                <span className="block text-sm text-muted">{task.hint}</span>
                {/* Срок есть не у всякой задачи: деньги дождутся, а
                    голосование закроется и решат без вас. */}
                {task.deadline ? (
                  <span
                    className={`block text-xs ${
                      task.tone === 'danger' ? 'text-danger' : 'text-muted'
                    }`}
                  >
                    {timeLeft(task.deadline)
                      ? `Закрывается через ${timeLeft(task.deadline)} — ${formatDateTime(task.deadline)}`
                      : `Срок вышел ${formatDateTime(task.deadline)}`}
                  </span>
                ) : null}
              </span>
              {task.count > 1 ? (
                <span className="shrink-0 tabular-nums">{task.count}</span>
              ) : null}
              <ChevronRight
                size={16}
                aria-hidden
                className="shrink-0 text-muted"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
