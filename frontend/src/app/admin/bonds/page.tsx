import { Cabinet } from '@/components/cabinet';
import { BondsList } from './bonds-list';

export const metadata = { title: 'Облигации — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Облигации">
      <BondsList />
    </Cabinet>
  );
}
