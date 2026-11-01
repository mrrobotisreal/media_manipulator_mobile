import { useEffect, useState } from 'react';
import { buildHeaders } from '@/api/baseQuery';
import { useAppSelector } from '@/state/hooks';
import { inlineResultUrl } from '../fetchResult';

export interface StreamSource {
  uri: string;
  headers: Record<string, string>;
}

/**
 * Owner headers + `GET /api/result/:jobId?sid=` for expo-video / expo-audio. `null` until the headers
 * are built (the Bearer token is async). Only used when `mimeFromServer`; otherwise download first.
 */
export function useStreamSource(jobId: string, enabled: boolean): StreamSource | null {
  const sessionId = useAppSelector((s) => s.session.sessionId);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void buildHeaders().then((h) => live && setHeaders(h));
    return () => {
      live = false;
    };
  }, [enabled, jobId]);
  if (!enabled || !headers) return null;
  return { uri: inlineResultUrl(jobId, sessionId), headers };
}
