import { Cabinet } from '@/components/cabinet';
import { BondsView } from './bonds-view';

export const metadata = { title: 'Мои бумаги — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Мои бумаги">
      <BondsView />
    </Cabinet>
  );
}
