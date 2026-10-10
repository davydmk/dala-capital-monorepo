import { Cabinet } from '@/components/cabinet';
import { PayView } from './pay-view';

export const metadata = { title: 'Оплатить — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Оплатить">
      <PayView />
    </Cabinet>
  );
}
