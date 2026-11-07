import { File } from 'expo-file-system';
import { copyToIntakeCache } from '@/files/intake';
import type { IntakeFile } from '@/files/types';
import { uuidv4 } from '@/lib/ids';
import { VOICE_RECORDING_MIME } from './recorderOptions';

/**
 * A finished recording as an `IntakeFile` (source `recorder`), so the tool screen's file card, the job
 * engine's cache sweep and the upload path treat it like any picked file. The take is copied into
 * `cache/intake/<id>/` (the recorder's own file is in the audio module's cache).
 */
export function intakeFileFromTake(
  take: { uri: string; durationSec: number },
  now: number = Date.now(),
): IntakeFile {
  const id = uuidv4();
  const name = `voice-sample-${now}.m4a`;
  const uri = copyToIntakeCache(take.uri, id, name, 0);
  let sizeBytes = 0;
  try {
    sizeBytes = new File(uri).size;
  } catch {
    sizeBytes = 0;
  }
  return {
    id,
    uri,
    name,
    extension: 'm4a',
    mimeType: VOICE_RECORDING_MIME,
    mediaKind: 'audio',
    sizeBytes,
    durationSec: take.durationSec,
    source: 'recorder',
    copiedAt: now,
  };
}

/** A placeholder source for jobs that upload nothing (speak): the engine record needs a file shape. */
export function textJobSource(now: number = Date.now()): IntakeFile {
  return {
    id: uuidv4(),
    uri: '',
    name: 'speech',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    mediaKind: 'audio',
    sizeBytes: 0,
    source: 'picker',
    copiedAt: now,
  };
}
