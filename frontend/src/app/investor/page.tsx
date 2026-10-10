import { Cabinet } from '@/components/cabinet';
import { OnboardingCard } from './onboarding-card';
import { InvestorDashboard } from './investor-dashboard';

export const metadata = { title: 'Кабинет инвестора — Dala Capital' };

export default function Page() {
  return (
    <Cabinet title="Дашборд">
      <div className="space-y-4">
        <OnboardingCard />
        <InvestorDashboard />
      </div>
    </Cabinet>
  );
}
