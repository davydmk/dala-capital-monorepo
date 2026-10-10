import { Cabinet } from '@/components/cabinet';
import { CampaignsList } from './campaigns-list';

export const metadata = { title: 'Кампании — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Кампании">
      <CampaignsList />
    </Cabinet>
  );
}
