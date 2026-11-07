import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { trackFileSelected } from '@/analytics/fileEvents';
import type { IntakeFile } from '@/files/types';
import { formatDuration } from '@/lib/format';
import { VOICE_REFERENCE_MIN_SECONDS } from '@/tools/voices/consent';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { intakeFileFromTake } from '../sample';
import { useRecorder } from '../useRecorder';
import { AudioClip } from './AudioClip';

/**
 * The microphone recorder (ticket MA34 decision 4): a pre-sheet before the first permission request, a live
 * level meter, a mono-numeral clock, auto-stop at `maxSeconds`, then the take with Play / Re-record /
 * Discard. A take shorter than `minSeconds` cannot be used ("Record at least 5 seconds"); a finished, long
 * enough take is handed to the parent as an `IntakeFile` (source `recorder`).
 */
export function RecorderPanel({
  minSeconds = 0,
  maxSeconds,
  onTake,
  onDiscard,
  hint,
}: {
  /** 5 for a clone sample; 0 for change / shift (any length, the plan's cap is checked by the form). */
  minSeconds?: number;
  maxSeconds: number;
  onTake: (file: IntakeFile) => void;
  onDiscard?: () => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const rec = useRecorder(maxSeconds);
  const [pre, setPre] = useState(false);
  const { state } = rec;
  const handed = useRef<string | null>(null);

  // A finished take long enough is handed over once.
  useEffect(() => {
    if (state.phase !== 'recorded' || !state.uri || handed.current === state.uri) return;
    if (minSeconds > 0 && state.durationSec < minSeconds) return;
    handed.current = state.uri;
    try {
      const file = intakeFileFromTake({ uri: state.uri, durationSec: state.durationSec });
      trackFileSelected(file);
      onTake(file);
    } catch {
      // the copy failed: the take stays on the card and Re-record is offered
      handed.current = null;
    }
  }, [state.phase, state.uri, state.durationSec, minSeconds, onTake]);

  const recording = state.phase === 'recording';
  const tooShort = state.phase === 'recorded' && state.verdict === 'too_short' && minSeconds > 0;

  return (
    <View className="gap-3 rounded-lg border border-edge bg-surface-1 p-3" testID="recorder-panel">
      {hint ? <Text className="text-sm text-muted-fg">{hint}</Text> : null}

      {recording ? (
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-primary">
              {t('interface:voiceTools.recorder.recording')}
            </Text>
            <Num testID="recorder-clock" className="text-lg">
              {formatDuration(state.elapsedMs / 1000)} / {formatDuration(maxSeconds)}
            </Num>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('interface:voiceTools.recorder.level')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(state.level * 100) }}
            className="h-2 overflow-hidden rounded-sm bg-surface-3"
          >
            <View
              testID="recorder-level"
              className="h-full bg-data"
              style={{ width: `${Math.round(state.level * 100)}%` }}
            />
          </View>
          <Button
            testID="recorder-stop"
            label={t('interface:voiceTools.recorder.stop')}
            onPress={() => void rec.stop()}
          />
        </View>
      ) : state.phase === 'recorded' && state.uri ? (
        <View className="gap-3">
          <Num className="text-sm text-muted-fg">
            {t('interface:voiceTools.recorder.recorded', {
              duration: formatDuration(state.durationSec),
            })}
          </Num>
          {state.interrupted ? (
            <Text className="text-sm text-muted-fg">{t('tools.voices.recorder.interrupted')}</Text>
          ) : null}
          {state.autoStopped ? (
            <Text className="text-sm text-muted-fg">{t('tools.voices.recorder.autoStopped')}</Text>
          ) : null}
          {tooShort ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="recorder-too-short"
              className="text-sm text-danger"
            >
              {t('tools.voices.recorder.tooShort', { min: VOICE_REFERENCE_MIN_SECONDS })}
            </Text>
          ) : null}
          <AudioClip
            uri={state.uri}
            label={t('tools.voices.recorder.playTake')}
            testID="recorder-play"
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              testID="recorder-rerecord"
              variant="secondary"
              label={t('tools.voices.recorder.rerecord')}
              onPress={() => {
                handed.current = null;
                rec.discard();
                setPre(true);
              }}
            />
            <Button
              testID="recorder-discard"
              variant="ghost"
              label={t('interface:voiceTools.recorder.remove')}
              onPress={() => {
                handed.current = null;
                rec.discard();
                onDiscard?.();
              }}
            />
          </View>
        </View>
      ) : (
        <View className="gap-2">
          <Button
            testID="recorder-record"
            variant="secondary"
            label={t('interface:voiceTools.recorder.record')}
            loading={state.phase === 'requesting'}
            onPress={() => setPre(true)}
          />
          <Num className="text-xs text-subtle">
            {t('tools.voices.recorder.limit', { max: formatDuration(maxSeconds) })}
          </Num>
          {state.phase === 'denied' ? (
            <Text
              testID="recorder-denied"
              accessibilityLiveRegion="polite"
              className="text-sm text-danger"
            >
              {t('tools.voices.micPermission.denied')}
            </Text>
          ) : null}
          {state.phase === 'blocked' ? (
            <View className="gap-2">
              <Text
                testID="recorder-blocked"
                accessibilityLiveRegion="polite"
                className="text-sm text-danger"
              >
                {t('tools.voices.micPermission.blocked')}
              </Text>
              <Button
                variant="ghost"
                label={t('tools.voices.micPermission.openSettings')}
                onPress={() => void Linking.openSettings()}
              />
            </View>
          ) : null}
          {state.phase === 'error' ? (
            <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
              {t('tools.voices.recorder.failed')}
            </Text>
          ) : null}
        </View>
      )}

      <Sheet visible={pre} onClose={() => setPre(false)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('tools.voices.micPermission.title')}</Text>
          <Text className="text-muted-fg">{t('tools.voices.micPermission.body')}</Text>
          <Button
            testID="recorder-pre-continue"
            label={t('common.continue')}
            onPress={() => {
              setPre(false);
              void rec.start();
            }}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setPre(false)} />
        </View>
      </Sheet>
    </View>
  );
}
