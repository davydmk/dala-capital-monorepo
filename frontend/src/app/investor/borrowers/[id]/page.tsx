import { Cabinet } from '@/components/cabinet';
import { BorrowerView } from './borrower-view';

export const metadata = { title: 'Заёмщик — Dala Capital' };

export default async function Page({
  params,
}: PageProps<'/investor/borrowers/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Заёмщик">
      <BorrowerView id={id} />
    </Cabinet>
  );
}
