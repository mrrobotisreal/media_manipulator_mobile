import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { linkPromptSet } from '@/state/slices/auth';
import { Button, Sheet, Text } from '@/ui/components';
import { clearPendingLink, linkProviderOptions } from '../linking';
import type { AuthMethod } from '../methods';

/**
 * "This email is already registered with another sign-in method." Offers the other providers
 * (all of them when Firebase's email-enumeration protection hides the list). The pending
 * credential stays in `linking.ts`; the sign-in that follows links it.
 */
export function LinkSheet({
  email,
  onPick,
}: {
  email?: string;
  onPick: (method: AuthMethod) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const attempted = useAppSelector((s) => s.auth.linkPrompt);
  const [options, setOptions] = useState<AuthMethod[]>([]);

  useEffect(() => {
    if (!attempted) return;
    let live = true;
    void linkProviderOptions(email, attempted).then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [attempted, email]);

  const close = () => {
    clearPendingLink();
    dispatch(linkPromptSet(null));
  };
  const label: Record<AuthMethod, string> = {
    apple: t('interface:authModal.appleSignIn'),
    google: t('interface:authModal.googleSignIn'),
    email: t('auth.signIn.email'),
  };

  return (
    <Sheet visible={attempted !== null} onClose={close}>
      <View className="gap-3" testID="link-sheet">
        <Text className="text-lg font-semibold">{t('auth.link.title')}</Text>
        <Text className="text-muted-fg">{t('interface:authModal.link.notice')}</Text>
        {options.map((m) => (
          <Button key={m} label={label[m]} variant="secondary" onPress={() => onPick(m)} />
        ))}
        <Button label={t('common.cancel')} variant="ghost" onPress={close} />
      </View>
    </Sheet>
  );
}
