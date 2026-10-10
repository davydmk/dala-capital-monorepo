import { Cabinet } from '@/components/cabinet';
import { ProfileView } from './profile-view';

export const metadata = { title: 'Профиль — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Профиль">
      <ProfileView />
    </Cabinet>
  );
}
