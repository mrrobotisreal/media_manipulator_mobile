import { crashlyticsTestCrash } from '@/analytics/crashlytics';
import { appVariant, type AppVariant } from '@/lib/appVariant';
import { Button } from '@/ui/components/Button';

/** Taps on the About version row that reveal the control. */
export const TEST_CRASH_TAPS = 7;

/**
 * Hidden "Send test crash" (MA25 decision 8, for MA28's Crashlytics check). Rendered ONLY in preview builds
 * (`appVariant() === 'preview'`) after 7 taps on the version row; production and development never show it.
 * Deliberately English-only (a developer control that never ships to the store build), so no locale key.
 */
export function TestCrashControl({
  taps,
  variant = appVariant(),
  onCrash = crashlyticsTestCrash,
}: {
  taps: number;
  variant?: AppVariant;
  onCrash?: () => void;
}) {
  if (variant !== 'preview' || taps < TEST_CRASH_TAPS) return null;
  return <Button testID="test-crash" label="Send test crash" variant="danger" onPress={onCrash} />;
}
