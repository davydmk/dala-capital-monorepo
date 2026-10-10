import { Cabinet } from '@/components/cabinet';
import { CampaignView } from './campaign-view';

export const metadata = { title: 'Кампания — Dala Capital' };

export default async function Page({
  params,
}: PageProps<'/investor/campaigns/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Кампания">
      <CampaignView id={id} />
    </Cabinet>
  );
}
