import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGetAssistantCapabilitiesQuery, guideEnabled } from '@/api/endpoints/assistant';
import { hitTarget } from '@/ui/tokens';
import { MEDI_BRAND } from '../brand';
import { openMedi } from '../mediUi';
import { MediMark } from './MediMark';

/**
 * The Tools-tab BrandBar's right-hand Medi button. Hidden until the capabilities say the guide
 * answers for this caller (flag off, operator-only, a failed call: no button, no dead end).
 */
export function MediButton() {
  const { t } = useTranslation();
  const caps = useGetAssistantCapabilitiesQuery();
  if (!guideEnabled(caps.data)) return null;
  return (
    <Pressable
      testID="medi-button"
      accessibilityRole="button"
      accessibilityLabel={t('assistant.open', { brand: MEDI_BRAND })}
      onPress={() => openMedi('button')}
      hitSlop={8}
      className="items-center justify-center"
      style={{ minWidth: hitTarget, minHeight: hitTarget }}
    >
      <MediMark size={30} />
    </Pressable>
  );
}
