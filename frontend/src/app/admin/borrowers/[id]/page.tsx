import { Cabinet } from '@/components/cabinet';
import { BorrowerDetails } from './borrower-details';

export const metadata = { title: 'Заёмщик — Dala Capital' };

export default async function Page({
  params,
}: PageProps<'/admin/borrowers/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Карточка заёмщика">
      <BorrowerDetails id={id} />
    </Cabinet>
  );
}
