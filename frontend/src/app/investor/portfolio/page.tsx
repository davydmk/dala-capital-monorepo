import { Cabinet } from '@/components/cabinet';
import { PortfolioView } from './portfolio-view';

export const metadata = { title: 'Портфель — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Портфель">
      <PortfolioView />
    </Cabinet>
  );
}
