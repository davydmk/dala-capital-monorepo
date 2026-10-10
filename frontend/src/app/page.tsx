import { redirect } from 'next/navigation';

/** Корень пока ведёт на вход: вошедших перехватывает proxy.ts и уводит в их кабинет. */
export default function Home() {
  redirect('/login');
}
