import { Cabinet } from '@/components/cabinet';
import { NewBorrower } from './new-borrower';

export const metadata = { title: 'Новый заёмщик — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Новый заёмщик">
      <NewBorrower />
    </Cabinet>
  );
}
