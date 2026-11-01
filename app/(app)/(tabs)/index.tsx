import { Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { AuthBanners } from '@/auth/ui/AuthBanners';
import { EmptyState, Screen } from '@/ui/components';

export default function ToolsTab() {
  const { t } = useTranslation();
  return (
    <Screen>
      <AuthBanners />
      <EmptyState icon={Wrench} title={t('tabs.tools')} body={t('placeholders.toolsBody')} />
    </Screen>
  );
}
