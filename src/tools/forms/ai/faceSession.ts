import type { DetectFacesResult } from '@/api/endpoints/ai';
import type { ToolContext } from '../../types';
import { detectionFor, type BlurFacesForm, type FaceDetectionState } from '../../options/ai';

export type DetectFn = (file: { uri: string; mimeType: string }) => Promise<DetectFacesResult>;

/** Face-count bucket for analytics (`feature_used {feature:'face_detect'}`). */
export function faceCountBucket(n: number): '0' | '1' | '2-5' | '6+' {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  return n <= 5 ? '2-5' : '6+';
}

export function toDetectionState(
  r: Extract<DetectFacesResult, { ok: true }>['data'],
  fileUri: string,
): FaceDetectionState {
  return {
    sessionId: r.faceDetectionSessionId,
    expiresAt: r.expiresAt,
    imageWidth: r.imageWidth,
    imageHeight: r.imageHeight,
    faces: r.faces.map((f) => ({
      id: f.id,
      index: f.index,
      confidence: f.confidence,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
    })),
    fileUri,
  };
}

export const isExpired = (d: FaceDetectionState, now: number) => {
  const t = Date.parse(d.expiresAt);
  return !Number.isFinite(t) || t <= now;
};

/**
 * Before Run in a selection mode: the detection must be fresh. The server forgets a session 30 min after
 * detection, so if it has expired (or belongs to another file) the faces are detected again silently from the
 * SAME cached file (the SHA must match), keeping the selected ids that still exist. `all` mode needs nothing.
 */
export async function ensureFreshDetection(
  form: BlurFacesForm,
  ctx: ToolContext | undefined,
  detect: DetectFn,
  now: number = Date.now(),
): Promise<BlurFacesForm> {
  if (form.selectionMode === 'all') return form;
  const input = ctx?.input;
  if (!input?.uri) return form;
  const current = detectionFor(form, ctx);
  if (current && !isExpired(current, now)) return form;
  const res = await detect({ uri: input.uri, mimeType: input.mime });
  if (!res.ok) throw new Error(`face re-detect failed: ${res.error.code}`);
  const detection = toDetectionState(res.data, input.uri);
  const known = new Set(detection.faces.map((f) => f.id));
  return { ...form, detection, selected: form.selected.filter((id) => known.has(id)) };
}
