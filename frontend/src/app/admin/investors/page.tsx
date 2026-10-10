import { Cabinet } from '@/components/cabinet';
import { InvestorsList } from './investors-list';

export const metadata = { title: 'Инвесторы — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Инвесторы">
      <InvestorsList />
    </Cabinet>
  );
}
