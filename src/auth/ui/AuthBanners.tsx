import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { appleLinkOfferSet, identityChanged, noticeSet } from '@/state/slices/auth';
import { Button, Text } from '@/ui/components';
import { sendVerificationEmail } from '../email';
import { currentUser, refreshIdentity } from '../firebase';
import { linkAppleNow } from '../linking';

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <View className="mx-4 mt-3 gap-2 rounded-md border border-edge bg-surface-1 p-3">
      {children}
    </View>
  );
}

/**
 * Top of the Tools tab: "Accounts linked" notice, the Android "Link Apple" offer and the
 * dismissible verify-email banner (password accounts only; never blocks tools).
 */
export function AuthBanners() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { notice, appleLinkOffer, emailVerified, providerIds } = useAppSelector((s) => s.auth);
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const needsVerify = !emailVerified && providerIds.includes('password') && !verifyDismissed;

  useEffect(() => {
    if (!needsVerify) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshIdentity()
        .then((identity) => identity && dispatch(identityChanged(identity)))
        .catch(() => {});
    });
    return () => sub.remove();
  }, [needsVerify, dispatch]);

  return (
    <>
      {notice === 'linked' ? (
        <Banner>
          <Text>{t('interface:authModal.link.linked')}</Text>
          <Button
            label={t('common.close')}
            variant="ghost"
            onPress={() => dispatch(noticeSet(null))}
          />
        </Banner>
      ) : null}
      {appleLinkOffer ? (
        <Banner>
          <Text>{t('auth.link.linkAppleBody')}</Text>
          <Button
            label={t('auth.link.linkApple')}
            variant="secondary"
            onPress={() => {
              const user = currentUser();
              if (user) void linkAppleNow(user, dispatch);
            }}
          />
          <Button
            label={t('common.close')}
            variant="ghost"
            onPress={() => dispatch(appleLinkOfferSet(false))}
          />
        </Banner>
      ) : null}
      {needsVerify ? (
        <Banner>
          <Text>{sent ? t('auth.verify.sent') : t('auth.verify.banner')}</Text>
          {sent ? null : (
            <Button
              label={t('auth.verify.send')}
              variant="secondary"
              onPress={() =>
                void sendVerificationEmail()
                  .then(() => setSent(true))
                  .catch(() => {})
              }
            />
          )}
          <Button
            label={t('common.close')}
            variant="ghost"
            onPress={() => setVerifyDismissed(true)}
          />
        </Banner>
      ) : null}
    </>
  );
}
