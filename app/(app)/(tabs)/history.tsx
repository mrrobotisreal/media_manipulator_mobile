import { History } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, Screen } from '@/ui/components';

export default function HistoryTab() {
  const { t } = useTranslation();
  return (
    <Screen>
      <EmptyState icon={History} title={t('tabs.history')} body={t('placeholders.historyBody')} />
    </Screen>
  );
}
