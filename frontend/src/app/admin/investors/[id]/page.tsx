import { Cabinet } from '@/components/cabinet';
import { InvestorDetails } from './investor-details';

export const metadata = { title: 'Инвестор — Dala Capital' };

export default async function Page({
  params,
}: PageProps<'/admin/investors/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Проверка инвестора">
      <InvestorDetails id={id} />
    </Cabinet>
  );
}
