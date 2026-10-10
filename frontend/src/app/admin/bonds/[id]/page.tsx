import { Cabinet } from '@/components/cabinet';
import { BondPageView } from './bond-page';

export const metadata = { title: 'Выпуск — Dala Capital' };

export default async function Page({ params }: PageProps<'/admin/bonds/[id]'>) {
  const { id } = await params;
  return (
    <Cabinet title="Выпуск">
      <BondPageView id={id} />
    </Cabinet>
  );
}
