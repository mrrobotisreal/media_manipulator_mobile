import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  createRecorderController,
  initialRecorderState,
  type RecorderController,
  type RecorderState,
} from '@/files/recorder';
import { VOICE_REFERENCE_MAX_SECONDS } from '@/tools/voices/consent';
import { VOICE_RECORDING_OPTIONS } from './recorderOptions';

/** The real recorder: expo-audio's `useAudioRecorder` behind the controller. */
export function useRecorder(maxSeconds: number = VOICE_REFERENCE_MAX_SECONDS): {
  state: RecorderState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => void;
} {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [state, setState] = useState<RecorderState>(initialRecorderState);
  // One controller per mounted recorder (a lazy state initializer, not a ref read in render).
  const [controller] = useState<RecorderController>(() =>
    createRecorderController({
      requestPermission: async () => {
        const r = await requestRecordingPermissionsAsync();
        return { granted: r.granted, canAskAgain: r.canAskAgain };
      },
      recorder: {
        prepareToRecordAsync: () => recorder.prepareToRecordAsync(),
        record: () => recorder.record(),
        stop: () => recorder.stop(),
        getStatus: () => recorder.getStatus(),
        get uri() {
          return recorder.uri;
        },
      },
      setRecordingMode: (on) => setAudioModeAsync({ allowsRecording: on, playsInSilentMode: true }),
      onAppState: (cb) => {
        const sub = AppState.addEventListener('change', cb);
        return () => sub.remove();
      },
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      onChange: setState,
      maxSeconds,
    }),
  );
  useEffect(() => () => controller.dispose(), [controller]);
  return {
    state,
    start: () => controller.start(),
    stop: () => controller.stop(),
    discard: () => controller.discard(),
  };
}
