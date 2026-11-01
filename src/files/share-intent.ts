import { useRouter, type Href } from 'expo-router';
import { useShareIntentContext, type ShareIntentFile } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import {
  trackFileRejected,
  trackFileSelected,
  trackShareIntentReceived,
} from '@/analytics/fileEvents';
import { useAppSelector } from '@/state/hooks';
import { prepareIntake } from './intake';
import { extensionOf, resolveKind, resolveMime } from './mime';
import { setIntakeBatch, type IntakeBatch } from './session';
import type { IncomingFile } from './types';
import { useAccountLimits } from './useAccountLimits';
import type { PreflightLimits } from './preflight';

export const INTAKE_HREF = '/(app)/intake' as Href;

/** Shared file entries that carry a usable path; text/url-only shares have none. */
export function sharedToIncoming(
  files: readonly ShareIntentFile[] | null | undefined,
): IncomingFile[] {
  return (files ?? [])
    .filter((f) => Boolean(f.path))
    .map((f) => ({
      uri: f.path,
      name: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.size,
      width: f.width,
      height: f.height,
    }));
}

/**
 * The JS MIME filter behind the plugin's catch-all `*` + `/*` intent filter: image, video, audio and
 * PDF pass; everything else is refused by `prepareIntake` as `unsupported_type`.
 */
export function sharedKinds(incoming: readonly IncomingFile[]) {
  return incoming.map((f) => {
    const ext = extensionOf(f.name ?? f.uri);
    return resolveKind(resolveMime(f.mimeType, ext), ext);
  });
}

/** Copies, checks and records a share; emits `share_intent_received`, `file_selected`, `file_rejected`. */
export async function processShare(
  incoming: IncomingFile[],
  limits?: PreflightLimits,
): Promise<IntakeBatch> {
  trackShareIntentReceived(sharedKinds(incoming));
  const res = await prepareIntake(incoming, { source: 'share', limits });
  res.accepted.forEach(trackFileSelected);
  res.rejected.forEach(trackFileRejected);
  const batch = { files: res.accepted, rejected: res.rejected };
  setIntakeBatch(batch);
  return batch;
}

/**
 * Mounted once under `ShareIntentProvider`. A non-empty share is held in memory until
 * `auth.status === 'ready'` (signed out -> the (auth) stack, then intake resumes after sync), then
 * copied, recorded and routed to the intake screen; `resetShareIntent()` runs after the copy.
 */
export function useShareIntentRouting(): void {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const ready = useAppSelector((s) => s.auth.status === 'ready');
  const limits = useAccountLimits();
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = sharedToIncoming(shareIntent.files);
    if (incoming.length === 0) {
      // Text / URL-only share (some gallery apps): not ours to open.
      resetShareIntent();
      return;
    }
    if (!ready || busy.current) return;
    busy.current = true;
    void processShare(incoming, limits)
      .catch(() => setIntakeBatch(null))
      .finally(() => {
        resetShareIntent();
        busy.current = false;
        router.push(INTAKE_HREF);
      });
    // `limits` is read once when the share is processed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, shareIntent, ready]);
}
