import { Cabinet } from '@/components/cabinet';
import { AdminDashboard } from './admin-dashboard';

export const metadata = { title: 'Кабинет администратора — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Дашборд">
      <AdminDashboard />
    </Cabinet>
  );
}
