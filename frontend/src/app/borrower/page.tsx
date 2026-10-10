import { Cabinet } from '@/components/cabinet';
import { BorrowerDashboard } from './borrower-dashboard';

export const metadata = { title: 'Кабинет заёмщика — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Дашборд">
      <BorrowerDashboard />
    </Cabinet>
  );
}
