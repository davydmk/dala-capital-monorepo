'use client';

/** Сессия пользователя: один запрос `/auth/me` на весь кабинет плюс выход. */
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
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
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      router.replace('/login');
      router.refresh();
    },
  });
}
