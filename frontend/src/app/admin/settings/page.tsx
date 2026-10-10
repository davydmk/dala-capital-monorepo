import { Cabinet } from '@/components/cabinet';
import { SettingsView } from './settings-view';

export const metadata = { title: 'Настройки — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Настройки">
      <SettingsView />
    </Cabinet>
  );
}
