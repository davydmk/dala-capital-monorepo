import { Cabinet } from '@/components/cabinet';
import { LoanView } from './loan-view';

export const metadata = { title: 'Мой займ — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Мой займ">
      <LoanView />
    </Cabinet>
  );
}
