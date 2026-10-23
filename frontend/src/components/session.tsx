'use client';

/** Сессия пользователя: один запрос `/auth/me` на весь кабинет плюс выход. */
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 401 повторять бессмысленно: пользователь просто не вошёл.
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useSession() {
  return useQuery<User>({ queryKey: ['session'], queryFn: api.me });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      // Куда вести, решаем по сессии из кэша, а не по состоянию экрана:
      // к моменту выхода экран мог уже перерисоваться. Гостю форма входа
      // ни к чему — у него нет доступов, его возвращаем на титульную.
      const session = queryClient.getQueryData<User>(['session']);
      const next = session?.viewer ? '/' : '/login';
      // Чистим весь кэш, а не одну сессию: иначе следующий вошедший увидит
      // данные предыдущего — имя, роль, задачи, кампании, — пока запросы не
      // переспросят сервер. В общем браузере это ещё и утечка.
      queryClient.clear();
      router.replace(next);
      router.refresh();
    },
  });
}
