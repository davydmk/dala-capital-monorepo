import { Cabinet } from '@/components/cabinet';
import { Verification } from './verification';

export const metadata = { title: 'Проверка личности — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Проверка личности">
      <Verification />
    </Cabinet>
  );
}
