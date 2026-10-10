import { Cabinet } from '@/components/cabinet';
import { CampaignPage } from './campaign-page';

export const metadata = { title: 'Кампания — Dala Capital' };

export default async function Page({
  params,
}: PageProps<'/admin/campaigns/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Кампания">
      <CampaignPage id={id} />
    </Cabinet>
  );
}
