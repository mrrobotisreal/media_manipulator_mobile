/* eslint-disable react-hooks/refs -- imperative editor glue: caches and the heal stroke list live in refs and are read by event handlers (and handed to the overlay once); none of it drives rendering. */
/**
 * The MA51 editor workspace: everything the canvas tools and the new sheets share, wired once per
 * editor (ticket MA51 decisions 2–10). Pure wiring over injected deps (the screen passes the real
 * Skia API and network; tests pass CanvasKit and a fake fetch):
 *
 * - the render pipeline + mask asset store (brush / subject rasters; redraw when they arrive);
 * - the preview source per heal base (`heals[].baseRef` → that base's proxy; undo swaps back);
 * - Select subject (POST masks/subject → cache the PNG → install a `subject` component);
 * - Heal (strokes → base-size mask → POST heal → job → swap the source, append the heal); the job
 *   id is kept in MMKV until it settles, the poll stops in the background (so the API's push
 *   fires) and resumes on the foreground, on reopening the project and on a `photo_heal` push tap
 *   (MA56);
 * - preset thumbnails (the photo at 256 px through each look, cached per source), Auto's
 *   256-bin histogram, the eyedropper readback, snapshots, analytics.
 */
import type { SkImage } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MmError } from '@/api/errors';
import {
  photoFailReason,
  trackPhotoAiMask,
  trackPhotoHeal,
  trackPhotoMaskAdded,
  trackPhotoPresetApplied,
  trackPhotoPresetSaved,
  trackPhotoPresetsMigrated,
  type PhotoMaskKind,
} from '@/analytics/photoEvents';
import {
  requestSubjectMask,
  waitForHeal,
  type AiDeps,
  type AiResult,
  type HealOutcome,
} from '../aiApi';
import { createSnapshots } from '../history';
import { appendHeal, currentBaseRef, baseHashOf } from '../healOps';
import {
  clearPendingHeal,
  readPendingHeal,
  savePendingHeal,
  trackHealSettled,
  type HealKv,
  type PendingHeal,
} from '../healPending';
import { addComponent, maskOfLayer } from '../maskOps';
import { mutate, type PhotoStore } from '../photoStore';
import { maskComponentSchema, type AdjustmentLayer, type PhotoDoc } from '../photoTypes';
import { histogram256, type Histogram256 } from '../presets/presetStore';
import { MaskAssetStore } from '../skia/maskAssets';
import { PhotoPipeline } from '../skia/pipeline';
import type { SkiaApi } from '../skia/shaderChain';
import { skiaPngEncoder } from '../tools/brush';
import { pixelAt, type Point } from '../tools/canvasMath';
import {
  beginHeal,
  healMaskSize,
  healRefusal,
  type HealStroke,
  type MaskSize,
} from '../tools/heal';
import { createToolStore } from '../tools/toolState';
import type { EditorTools } from './EditorContext';
import { outputSizeOf } from '../tools/ToolOverlay';

export interface WorkspaceIo {
  ai: AiDeps;
  subjectBytes: (projectId: string, maskRef: string) => Promise<Uint8Array | null>;
  /** The canvas source for a heal base (its proxy), or null when it cannot be had. */
  baseImage: (projectId: string, baseRef: string) => Promise<SkImage | null>;
  /** Write PNG bytes (the heal mask; MA53 a preset thumbnail) to a local cache file; its uri. */
  writeMask: (bytes: Uint8Array) => Promise<string>;
  renderHealMask: (strokes: { pts: Point[]; diameter: number }[], size: MaskSize) => Uint8Array;
  /** MA56: where a heal in flight is kept across an app kill (MMKV in the app). */
  pending?: HealKv;
  now?: () => number;
}

export interface WorkspaceProps {
  api: SkiaApi;
  io: WorkspaceIo;
  store: PhotoStore;
  /** The original-derived preview (local decode or the project proxy). */
  original: SkImage | null;
  projectId: string | null;
  capabilities?: { aiMasks: boolean; heal: boolean };
  slug?: string;
  /** A 429 / tier refusal goes to the MA16 limit sheet; anything else to a notice. */
  onLimit: (e: MmError) => boolean;
  onNotice: (key: string, kind?: 'error') => void;
  gpu?: boolean;
}

const THUMB_SIDE = 256;
/** MA53 account thumbnail: 96 px (MM103 design), PNG (`ImageFormat.PNG` = 4), ≤ 64 KB. */
const PRESET_THUMB_PX = 96;
const PNG_FORMAT = 4;
const PRESET_THUMB_MAX_BYTES = 64 * 1024;

/**
 * MA56: editors mounted per project, newest last. Only the newest resumes and installs a pending
 * heal, so an editor left under another screen (a push tap opened a second one) never installs it
 * twice.
 */
const healOwners = new Map<string, symbol[]>();
const isHealOwner = (projectId: string, token: symbol) =>
  healOwners.get(projectId)?.at(-1) === token;

export function useEditorWorkspace(p: WorkspaceProps) {
  const { api, io, store, projectId } = p;
  const tools = useMemo(() => createToolStore(), []);
  const snapshots = useMemo(() => createSnapshots(), []);
  const projectRef = useRef(projectId);
  useEffect(() => {
    projectRef.current = projectId;
  }, [projectId]);
  const assets = useMemo(
    () =>
      new MaskAssetStore(
        api,
        {
          subjectBytes: (ref) =>
            projectRef.current ? io.subjectBytes(projectRef.current, ref) : Promise.resolve(null),
        },
        p.gpu,
      ),
    [api, io, p.gpu],
  );
  const pipeline = useMemo(
    () => new PhotoPipeline(api, assets, { gpu: p.gpu, feather: p.gpu ? 'skia' : 'exact' }),
    [api, assets, p.gpu],
  );
  const encodePng = useMemo(() => skiaPngEncoder(api as never), [api]);
  const [assetsRevision, setAssetsRevision] = useState(0);
  const [subjectBusy, setSubjectBusy] = useState(false);
  const [healState, setHealState] = useState<EditorTools['healState']>({
    phase: 'idle',
    progress: 0,
  });
  // One mutable list per editor (the overlay appends; the Heal press reads and clears it).
  const healStrokes = useRef<HealStroke[]>([]).current;
  const baseSizes = useRef<Record<string, MaskSize>>({});
  const bases = useRef(new Map<string, SkImage>());
  const [source, setSource] = useState<{ image: SkImage; id: string } | null>(null);

  // Mask rasters: decode what the doc needs; redraw when they land.
  useEffect(() => {
    const off = assets.subscribe(() => {
      pipeline.invalidateMasks();
      setAssetsRevision((n) => n + 1);
    });
    const ensure = () => {
      const d = store.getState().doc;
      if (d) void assets.ensure(d);
    };
    ensure();
    const unsub = store.subscribe(ensure);
    return () => {
      off();
      unsub();
    };
  }, [assets, pipeline, store]);

  // The canvas source follows the doc's current heal base (undo of a heal swaps back).
  useEffect(() => {
    if (!p.original) return;
    let cancelled = false;
    const sync = () => {
      const d = store.getState().doc;
      const ref = d ? currentBaseRef(d) : null;
      if (!ref || !projectRef.current) {
        setSource((s) =>
          s?.id === 'original' && s.image === p.original
            ? s
            : { image: p.original!, id: 'original' },
        );
        return;
      }
      const hit = bases.current.get(ref);
      if (hit) {
        setSource((s) => (s?.id === ref ? s : { image: hit, id: ref }));
        return;
      }
      void io.baseImage(projectRef.current, ref).then((img) => {
        if (cancelled || !img) return;
        bases.current.set(ref, img);
        setSource({ image: img, id: ref });
      });
    };
    sync();
    const unsub = store.subscribe(sync);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [p.original, store, io]);

  const readPixels = useCallback(
    (w?: number, h?: number) => {
      const d = store.getState().doc;
      if (!d || !source) return null;
      return pipeline.readPixels(source, d, w && h ? { width: w, height: h } : {});
    },
    [store, source, pipeline],
  );

  const readPixel = useCallback(
    (n: Point) => {
      const r = readPixels();
      return r ? pixelAt(r.pixels, r.width, r.height, n) : null;
    },
    [readPixels],
  );

  const onMaskAdded = useCallback(
    (kind: PhotoMaskKind) => trackPhotoMaskAdded(kind, p.slug),
    [p.slug],
  );

  const selectSubject = useCallback(
    async (layerId: string) => {
      const pid = projectRef.current;
      if (!pid) return p.onNotice('photo.masks.needsProject');
      const d0 = store.getState().doc;
      if (!d0) return;
      setSubjectBusy(true);
      const ev = trackPhotoAiMask(p.slug);
      const r = await requestSubjectMask(io.ai, pid, baseHashOf(currentBaseRef(d0)));
      if (!r.ok) {
        setSubjectBusy(false);
        ev.failed(photoFailReason(r.error.code, r.error.status));
        if (!p.onLimit(r.error)) p.onNotice('interface:photo.masks.subject.failed', 'error');
        return;
      }
      await assets.ensure({
        layers: [
          {
            id: 'x',
            type: 'invert',
            enabled: true,
            opacity: 1,
            blend: 'normal',
            params: {},
            mask: {
              components: [
                { kind: 'subject', mode: 'add', maskRef: r.value.maskRef, invert: false },
              ],
              feather: 0,
              invert: false,
              opacity: 1,
            },
          } as unknown as AdjustmentLayer,
        ],
      });
      setSubjectBusy(false);
      if (!assets.has(r.value.maskRef)) {
        ev.failed('error');
        return p.onNotice('interface:photo.masks.subject.failed', 'error');
      }
      const comp = maskComponentSchema.parse({
        kind: 'subject',
        mode: 'add',
        maskRef: r.value.maskRef,
        invert: false,
      });
      mutate(store, 'selectSubject', (d) => addComponent(d, layerId, comp));
      const n = maskOfLayer(store.getState().doc!, layerId)?.components.length ?? 1;
      tools.set({ component: n - 1, tool: 'none' });
      ev.completed();
      trackPhotoMaskAdded('subject', p.slug);
    },
    [store, io, assets, tools, p],
  );

  const clearHealStrokes = useCallback(() => {
    healStrokes.length = 0;
    tools.set({ healStrokes: 0 });
  }, [tools, healStrokes]);

  // MA56: the heal in flight survives backgrounding (the poll stops; the API pushes when nobody
  // polls) and an app kill (MMKV `photoHealPending:<projectId>`). One poll per job at a time; a
  // job is installed at most once per editor.
  const pending = useRef<PendingHeal | null>(null);
  const poll = useRef<{ jobId: string; abort: AbortController } | null>(null);
  const settled = useRef(new Set<string>());
  const startedHere = useRef(new Set<string>());
  const kv = io.pending;
  const now = io.now ?? Date.now;
  const owner = useMemo(() => Symbol('heal-owner'), []);
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });

  const settle = useCallback(
    async (rec: PendingHeal, r: AiResult<HealOutcome>) => {
      const { onLimit } = latest.current;
      if (settled.current.has(rec.jobId) || !isHealOwner(rec.projectId, owner)) return;
      const forget = async () => {
        settled.current.add(rec.jobId);
        if (pending.current?.jobId === rec.jobId) pending.current = null;
        if (kv) await clearPendingHeal(kv, rec.projectId, rec.jobId);
      };
      if (!r.ok) {
        // A dropped connection keeps the record: the next foreground polls again.
        if (r.error.status === 'FETCH_ERROR') {
          setHealState({ phase: 'failed', progress: 0 });
          return;
        }
        await forget();
        trackHealSettled(
          rec,
          { ok: false, reason: photoFailReason(r.error.code, r.error.status) },
          now(),
        );
        setHealState({ phase: onLimit(r.error) ? 'idle' : 'failed', progress: 0 });
        return;
      }
      const o = r.value;
      const d = store.getState().doc;
      if (!d || projectRef.current !== rec.projectId) return;
      // Already in the doc (installed before an app kill and saved): nothing to do.
      if (currentBaseRef(d) === o.baseRef) {
        await forget();
        setHealState({ phase: 'idle', progress: 0 });
        return;
      }
      // The doc moved to another base meanwhile (undo, another device): this heal no longer fits.
      if ((baseHashOf(currentBaseRef(d)) ?? '') !== rec.base) {
        await forget();
        trackHealSettled(rec, { ok: false, reason: 'error' }, now());
        setHealState({ phase: 'failed', progress: 0 });
        return;
      }
      settled.current.add(rec.jobId);
      // Install the new base first (a fetch failure leaves the doc untouched), then record it.
      const img = await io.baseImage(rec.projectId, o.baseRef);
      if (!img) {
        settled.current.delete(rec.jobId); // retried on the next foreground
        setHealState({ phase: 'failed', progress: 0 });
        return;
      }
      bases.current.set(o.baseRef, img);
      if (o.width > 0) baseSizes.current[o.baseRef] = { width: o.width, height: o.height };
      mutate(store, 'heal', (doc) => appendHeal(doc, { baseRef: o.baseRef, maskRef: o.maskRef }));
      await forget();
      if (startedHere.current.has(rec.jobId)) clearHealStrokes();
      setHealState({ phase: 'idle', progress: 0 });
      trackHealSettled(rec, { ok: true }, now());
    },
    [store, io, kv, now, owner, clearHealStrokes],
  );

  /** Poll the pending heal's job (no-op while that job is already polled). */
  const resumeHeal = useCallback(
    async (rec: PendingHeal) => {
      if (settled.current.has(rec.jobId)) return;
      pending.current = rec;
      // Backgrounded (e.g. during the heal POST): the foreground listener resumes it.
      if (AppState.currentState !== 'active') return;
      const cur = poll.current;
      if (cur && cur.jobId === rec.jobId && !cur.abort.signal.aborted) return;
      cur?.abort.abort();
      const mine = { jobId: rec.jobId, abort: new AbortController() };
      poll.current = mine;
      setHealState({ phase: 'running', progress: 0 });
      const r = await waitForHeal(io.ai, rec.jobId, {
        signal: mine.abort.signal,
        onProgress: (pr) => {
          if (poll.current === mine) setHealState({ phase: 'running', progress: pr });
        },
      });
      if (poll.current === mine) poll.current = null;
      // Backgrounded or unmounted: the record stays; the next foreground resumes.
      if (!r.ok && mine.abort.signal.aborted) return;
      await settle(rec, r);
    },
    [io, settle],
  );

  // Resume: the project's persisted heal once its doc is open, and on every return to the foreground.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let opened = false;
    healOwners.set(projectId, [...(healOwners.get(projectId) ?? []), owner]);
    const resume = async () => {
      if (!store.getState().doc || !isHealOwner(projectId, owner)) return;
      opened = true;
      const rec =
        pending.current?.projectId === projectId
          ? pending.current
          : kv
            ? await readPendingHeal(kv, projectId, now())
            : null;
      if (alive && rec) void resumeHeal(rec);
    };
    void resume();
    // The doc may land after the project id (an open in flight): check once when it does.
    const unsub = store.subscribe(() => {
      if (!opened && store.getState().doc) void resume();
    });
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') void resume();
      else poll.current?.abort.abort();
    });
    return () => {
      alive = false;
      unsub();
      app.remove();
      poll.current?.abort.abort();
      const left = (healOwners.get(projectId) ?? []).filter((t) => t !== owner);
      if (left.length) healOwners.set(projectId, left);
      else healOwners.delete(projectId);
    };
  }, [projectId, store, kv, now, owner, resumeHeal]);

  const heal = useCallback(async () => {
    const pid = projectRef.current;
    const d = store.getState().doc;
    if (!d) return;
    const mask = healMaskSize(d, baseSizes.current);
    const refusal = healRefusal(d, pid, healStrokes.length, mask, p.capabilities?.heal !== false);
    if (refusal) {
      if (refusal === 'too_large') p.onNotice('photo.heal.tooLarge', 'error');
      else if (refusal === 'no_project') p.onNotice('photo.heal.needsProject');
      else if (refusal === 'unavailable') p.onNotice('interface:photo.heal.unavailable');
      return;
    }
    if (poll.current) return;
    setHealState({ phase: 'running', progress: 0 });
    const startedAt = now();
    const ev = trackPhotoHeal(p.slug);
    const r = await beginHeal(
      {
        ai: io.ai,
        renderMask: async (strokes, size) => io.writeMask(io.renderHealMask(strokes, size)),
      },
      {
        projectId: pid!,
        doc: d,
        strokes: [...healStrokes],
        out: outputSizeOf(d, { width: d.source.width, height: d.source.height }),
        mask,
      },
    );
    if (!r.ok) {
      ev.failed(photoFailReason(r.error.code, r.error.status));
      setHealState({ phase: p.onLimit(r.error) ? 'idle' : 'failed', progress: 0 });
      return;
    }
    const rec: PendingHeal = { jobId: r.jobId, projectId: pid!, base: r.base, startedAt };
    if (p.slug) rec.slug = p.slug;
    startedHere.current.add(rec.jobId);
    pending.current = rec;
    if (kv) await savePendingHeal(kv, rec);
    await resumeHeal(rec);
  }, [store, io, p, healStrokes, kv, now, resumeHeal]);

  // Preset thumbnails: the photo at <= 256 px through each look (cached per source + preset).
  const thumbs = useRef(new Map<string, SkImage | null>());
  const thumbSource = useMemo(() => {
    if (!source) return null;
    const w = source.image.width();
    const h = source.image.height();
    const k = Math.min(1, THUMB_SIDE / Math.max(w, h));
    if (k === 1) return { image: source.image, id: `${source.id}:thumb` };
    const s = api.Surface.Make(Math.round(w * k), Math.round(h * k));
    if (!s) return null;
    s.getCanvas().drawImageRect(
      source.image,
      api.XYWHRect(0, 0, w, h),
      api.XYWHRect(0, 0, Math.round(w * k), Math.round(h * k)),
      api.Paint(),
    );
    s.flush();
    thumbs.current.clear();
    return { image: s.makeImageSnapshot(), id: `${source.id}:thumb` };
  }, [source, api]);
  const thumbPipeline = useMemo(() => new PhotoPipeline(api), [api]);
  const renderThumb = useCallback(
    (layers: AdjustmentLayer[]): SkImage | null => {
      if (!thumbSource) return null;
      const d = store.getState().doc;
      const doc: Pick<PhotoDoc, 'layers' | 'geometry' | 'masks'> = {
        layers,
        geometry: d?.geometry ?? {
          rotate: 0,
          flipH: false,
          flipV: false,
          perspective: null,
          crop: null,
          fill: 'transparent',
        },
      };
      const r = thumbPipeline.readPixels(thumbSource, doc);
      return r
        ? api.Image.MakeImage(
            { width: r.width, height: r.height, colorType: 4, alphaType: 3 },
            api.Data.fromBytes(r.pixels),
            r.width * 4,
          )
        : null;
    },
    [thumbSource, thumbPipeline, store, api],
  );
  const presetThumb = useCallback(
    (key: string, layers: AdjustmentLayer[]) => {
      if (!thumbSource) return null;
      const k = `${thumbSource.id}|${key}`;
      if (thumbs.current.has(k)) return thumbs.current.get(k) ?? null;
      const img = renderThumb(layers);
      thumbs.current.set(k, img);
      return img;
    },
    [thumbSource, renderThumb],
  );
  // MA53: the account thumbnail (MM103: PNG ≤ 64 KB, ≤ 256 px): the photo through the preset at
  // 96 px on the long side, written to a cache file for the multipart upload. Best effort.
  const presetThumbFile = useCallback(
    async (layers: AdjustmentLayer[]): Promise<string | null> => {
      try {
        const img = renderThumb(layers);
        if (!img) return null;
        const w = img.width();
        const h = img.height();
        const k = Math.min(1, PRESET_THUMB_PX / Math.max(w, h));
        const tw = Math.max(1, Math.round(w * k));
        const th = Math.max(1, Math.round(h * k));
        const s = api.Surface.Make(tw, th);
        if (!s) return null;
        s.getCanvas().drawImageRect(
          img,
          api.XYWHRect(0, 0, w, h),
          api.XYWHRect(0, 0, tw, th),
          api.Paint(),
        );
        s.flush();
        const bytes = s.makeImageSnapshot().encodeToBytes(PNG_FORMAT);
        if (!bytes || bytes.length === 0 || bytes.length > PRESET_THUMB_MAX_BYTES) return null;
        return await io.writeMask(bytes);
      } catch {
        return null;
      }
    },
    [renderThumb, api, io],
  );

  const hist = useCallback((): Histogram256 | null => {
    const d = store.getState().doc;
    if (!d || !source) return null;
    const out = outputSizeOf(d, { width: source.image.width(), height: source.image.height() });
    const k = Math.min(1, 512 / Math.max(out.width, out.height));
    const r = readPixels(
      Math.max(1, Math.round(out.width * k)),
      Math.max(1, Math.round(out.height * k)),
    );
    return r ? histogram256(r.pixels) : null;
  }, [store, source, readPixels]);

  const extra: EditorTools = {
    tools,
    snapshots,
    sourceSize: (() => {
      const d = store.getState().doc;
      return d ? { width: d.source.width, height: d.source.height } : { width: 1, height: 1 };
    })(),
    capabilities: p.capabilities,
    selectSubject,
    subjectBusy,
    heal,
    healState,
    clearHealStrokes,
    histogram256: hist,
    presetThumb,
    presetThumbFile,
    onPresetApplied: (id, scope) => trackPhotoPresetApplied(id, scope, p.slug),
    onPresetSaved: (layers) => trackPhotoPresetSaved(layers, p.slug),
    onPresetsMigrated: (count, declined) => trackPhotoPresetsMigrated(count, declined, p.slug),
    onLimit: (e) => p.onLimit(e),
  };

  return {
    extra,
    tools,
    pipeline,
    assets,
    assetsRevision,
    source,
    encodePng,
    readPixel,
    healStrokes,
    onMaskAdded,
    brushAlpha: (png: string) => assets.alphaOf(png),
    onBrushBaked: (png: string, a: import('../colorMath').AlphaImage) => assets.putAlpha(png, a),
  };
}
