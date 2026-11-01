import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/ui/tokens';
import { authT } from '../strings';

/** Splash-coloured hold while the auth state is resolving or `/account/sync` runs. */
export function SyncLoading() {
  return (
    <View
      className="flex-1 items-center justify-center bg-surface-0"
      accessibilityLabel={authT('sync.loading')}
      testID="sync-loading"
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
