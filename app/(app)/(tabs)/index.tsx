import { Wrench } from 'lucide-react-native';
import { AuthBanners } from '@/auth/ui/AuthBanners';
import { EmptyState, Screen } from '@/ui/components';

export default function ToolsTab() {
  return (
    <Screen>
      <AuthBanners />
      <EmptyState icon={Wrench} title="Tools" body="Tools arrive in MA10." /> {/* i18n: MA05 */}
    </Screen>
  );
}
