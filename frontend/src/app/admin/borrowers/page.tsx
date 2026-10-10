import { Cabinet } from '@/components/cabinet';
import { BorrowersList } from './borrowers-list';

export const metadata = { title: 'Заёмщики — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Заёмщики">
      <BorrowersList />
    </Cabinet>
  );
}
