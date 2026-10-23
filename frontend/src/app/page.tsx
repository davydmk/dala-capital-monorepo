import type { Metadata } from 'next';
import { Welcome } from './welcome';

export const metadata: Metadata = {
  title: 'Dala Capital — частное кредитование и облигации на Solana',
  description:
    'Обслуживание токенизированной облигации: дата фиксации, реестр держателей, расчёт прав, купон и погашение',
};

/**
 * Корень открыт всем: раньше он уводил прямо на форму входа, и человек со
 * стороны видел логин без единого слова о том, куда он попал. Вошедшего
 * по-прежнему перехватывает proxy.ts и уводит в его кабинет.
 */
export default function Home() {
  return <Welcome />;
}
