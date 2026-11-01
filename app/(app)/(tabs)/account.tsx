import { CircleUser } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { performSignOut } from '@/auth/signOut';
import { authT } from '@/auth/strings';
import { useAppDispatch } from '@/state/hooks';
import { Button, EmptyState, Screen, Sheet, Text } from '@/ui/components';

export default function AccountTab() {
  const dispatch = useAppDispatch();
  const [confirming, setConfirming] = useState(false);
  return (
    <Screen>
      <EmptyState icon={CircleUser} title="Account" body="Account arrives in MA22." />{' '}
      {/* i18n: MA05 */}
      <View className="px-6 pb-6">
        <Button
          label={authT('signOut.button')}
          variant="secondary"
          onPress={() => setConfirming(true)}
        />
      </View>
      <Sheet visible={confirming} onClose={() => setConfirming(false)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{authT('signOut.confirmTitle')}</Text>
          <Text className="text-muted-fg">{authT('signOut.confirmBody')}</Text>
          <Button
            label={authT('signOut.confirm')}
            variant="danger"
            onPress={() => {
              setConfirming(false);
              void performSignOut(dispatch);
            }}
          />
          <Button
            label={authT('signOut.cancel')}
            variant="ghost"
            onPress={() => setConfirming(false)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
