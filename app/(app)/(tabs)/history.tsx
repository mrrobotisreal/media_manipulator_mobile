import { History } from 'lucide-react-native';
import { EmptyState, Screen } from '@/ui/components';

export default function HistoryTab() {
  return (
    <Screen>
      <EmptyState icon={History} title="History" body="Your jobs will appear here." />{' '}
      {/* i18n: MA05 */}
    </Screen>
  );
}
