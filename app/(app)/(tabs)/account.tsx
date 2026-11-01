import { CircleUser } from 'lucide-react-native';
import { EmptyState, Screen } from '@/ui/components';

export default function AccountTab() {
  return (
    <Screen>
      <EmptyState icon={CircleUser} title="Account" body="Account arrives in MA15." />{' '}
      {/* i18n: MA05 */}
    </Screen>
  );
}
