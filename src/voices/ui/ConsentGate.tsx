import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { openWebPage } from '@/account/openWeb';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { TERMS_PATH, webUrl } from '@/lib/webUrl';
import { VOICE_CONSENT_TEXT_VERSION } from '@/tools/voices/consent';
import { Text } from '@/ui/components/Text';

/**
 * The consent record's checkbox (ticket MA34 decision 3, LEGAL TEXT). The label is the synced web sentence
 * `interface:voiceTools.consent.label` and the note `consent.note` names Terms 8.11 and the version; both are
 * copied, never paraphrased. The checkbox state lives in the parent so a new recording can reset it.
 */
export function ConsentGate({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const label = t('interface:voiceTools.consent.label');
  return (
    <View className="gap-2 rounded-lg border border-edge bg-surface-1 p-3" testID="consent-gate">
      <Pressable
        testID="consent-checkbox"
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked, disabled: !!disabled }}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        className="flex-row items-start gap-3"
        style={{ minHeight: 44 }}
      >
        <View
          className={`mt-0.5 size-6 items-center justify-center rounded-sm border ${checked ? 'border-primary bg-primary' : 'border-edge-control'}`}
        >
          {checked ? <Text className="text-sm font-bold text-on-primary">{'\u2713'}</Text> : null}
        </View>
        <Text className="flex-1">{label}</Text>
      </Pressable>
      <Text className="text-sm text-subtle">
        {t('interface:voiceTools.consent.note', { version: VOICE_CONSENT_TEXT_VERSION })}
      </Text>
      <Pressable
        testID="consent-terms-link"
        accessibilityRole="link"
        onPress={() => void openWebPage(webUrl(TERMS_PATH, locale))}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text className="text-sm text-data">{t('tools.voices.consent.terms')}</Text>
      </Pressable>
    </View>
  );
}
