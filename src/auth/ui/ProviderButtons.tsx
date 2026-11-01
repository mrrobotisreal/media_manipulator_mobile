import { appleAuth, AppleButton } from '@invertase/react-native-apple-authentication';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { Button } from '@/ui/components';
import { isGoogleAvailable } from '../google';

/** Apple (HIG: black or white), then Google. Same 52px height; the email entry point is the caller's. */
export function ProviderButtons({
  onApple,
  onGoogle,
  disabled,
}: {
  onApple: () => void;
  onGoogle: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-3 self-stretch">
      {Platform.OS === 'ios' && appleAuth.isSupported ? (
        <AppleButton
          buttonStyle={AppleButton.Style.WHITE}
          buttonType={AppleButton.Type.CONTINUE}
          buttonText={t('interface:authModal.appleSignIn')}
          cornerRadius={6}
          style={{ width: '100%', height: 52, opacity: disabled ? 0.5 : 1 }}
          onPress={() => {
            if (!disabled) onApple();
          }}
        />
      ) : (
        <Button
          label={t('interface:authModal.appleSignIn')}
          variant="secondary"
          size="lg"
          disabled={disabled}
          onPress={onApple}
          testID="apple-button"
        />
      )}
      {isGoogleAvailable() ? (
        <Button
          label={t('interface:authModal.googleSignIn')}
          variant="secondary"
          size="lg"
          disabled={disabled}
          onPress={onGoogle}
          testID="google-button"
        />
      ) : null}
    </View>
  );
}
