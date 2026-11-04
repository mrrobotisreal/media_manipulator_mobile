/* eslint-disable react-hooks/refs -- the tool glue is imperative by design: gesture callbacks write the drag state into refs and the overlay drawer (run on the re-render they request) reads it; nothing here is React state. */
/**
 * The canvas tools (ticket MA51 decisions 3–6; the web's `components/photo/tool-overlay.tsx`):
 * one hook that returns the canvas's `CanvasToolHost` (the tool gesture + the Skia overlay).
 *
 * Gestures (proposed in the ticket): ONE finger belongs to the armed tool; two fingers still pinch
 * and pan the canvas (PhotoCanvas raises its pan to two pointers). Handles are 44 pt targets.
 * - gradient: drag a line (from → to); drag either round handle to move it;
 * - radial: drag from the centre outwards; handles for the centre, the two radii and the rotation;
 * - brush: paint; the stroke is shown live and baked to the layer's brush PNG on release;
 * - eyedropper (colour range): tap = this colour, long press = add another (up to 8);
 * - crop: drag the eight handles or inside the rectangle (aspect from the Geometry sheet);
 * - straighten: draw a line along the horizon; perspective: drag the four corners;
 * - heal: paint spots (the Heal sheet sends them); red-eye: tap an eye.
 *
 * Every gesture is ONE undo step (`gestureBegan` / `gestureEnded` around live handle drags, one
 * `mutate` for drawn components). Coordinates: normalized geometry space (`canvasMath.ts`).
 */
import { Circle, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import { applyCropRemap, patchGeometry } from '../geometryOps';
import type { PngEncoder } from '../brushEngine';
import { geometryOutputSize, type AlphaImage } from '../colorMath';
import { addComponent, maskOfLayer, setBrushComponent, updateComponent } from '../maskOps';
import { mutate, photoActions, type PhotoStore } from '../photoStore';
import type { PhotoDoc } from '../photoTypes';
import {
  aspectValue,
  dragCrop,
  isZeroPerspective,
  movePerspectiveCorner,
  straightenAngle,
  type CropHandle,
  type PerspectiveCorner,
} from '../toolMath';
import type { CanvasToolHost } from '../skia/PhotoCanvas';
import { beginBrush, bakeInto, brushIndexOf, paintStroke, type BrushSession } from './brush';
import {
  gradientComponent,
  handleAngle,
  normToScreen,
  pickColorTarget,
  radialComponent,
  redEyeAt,
  screenToImage,
  screenToNorm,
  type Point,
  type ViewState,
} from './canvasMath';
import type { HealStroke } from './heal';
import { useToolState, type ToolStore } from './toolState';

const HIT = 22; // half of the 44 pt target
const ONE_FINGER_TOOLS = new Set([
  'gradient',
  'radial',
  'brush',
  'crop',
  'straighten',
  'perspective',
  'heal',
]);
const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS: PerspectiveCorner[] = ['tl', 'tr', 'br', 'bl'];

export interface ToolDeps {
  store: PhotoStore;
  tools: ToolStore;
  /** Original-pixel size of the source the doc describes. */
  sourceSize: { width: number; height: number };
  /** RGB of the rendered preview at a normalized point (the eyedropper). */
  readPixel: (n: Point) => { r: number; g: number; b: number } | null;
  /** Decoded alpha of a brush PNG already in the doc (to continue painting it). */
  brushAlpha: (png: string) => AlphaImage | null;
  encodePng: PngEncoder;
  /** A brush was baked: its raster is known without a decode. */
  onBrushBaked?: (png: string, alpha: AlphaImage) => void;
  /** Heal strokes recorded so far (owned by the editor; the Heal sheet sends them). */
  healStrokes: HealStroke[];
  onMaskAdded?: (kind: 'gradient' | 'radial' | 'brush' | 'colorRange') => void;
  onRefused?: (reason: 'brush_full' | 'brush_too_big' | 'no_layer') => void;
}

type Drag =
  | { kind: 'gradient-new'; a: Point; b: Point }
  | { kind: 'radial-new'; a: Point; b: Point }
  | { kind: 'handle'; handle: string }
  | { kind: 'brush'; pts: Point[] }
  | { kind: 'heal'; pts: Point[] }
  | { kind: 'crop'; handle: CropHandle; a: Point; rect0: CropRectN }
  | { kind: 'persp'; corner: PerspectiveCorner; a: Point }
  | { kind: 'line'; a: Point; b: Point };

interface CropRectN {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL: CropRectN = { x: 0, y: 0, width: 1, height: 1 };

/** Output size in ORIGINAL pixels (masks and heals are sized from it, not from the preview). */
export const outputSizeOf = (doc: PhotoDoc, source: { width: number; height: number }) =>
  geometryOutputSize(doc.geometry, source.width, source.height);

export function useToolOverlay(deps: ToolDeps, revision: number): CanvasToolHost {
  const { store, tools } = deps;
  const tool = useToolState(tools, (s) => s.tool);
  const maskView = useToolState(tools, (s) => s.maskView);
  const brush = useToolState(tools, (s) => s.brush);
  const healSize = useToolState(tools, (s) => s.healSize);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const view = useRef<ViewState | null>(null);
  const drag = useRef<Drag | null>(null);
  const session = useRef<BrushSession | null>(null);
  const [cropDraft, setCropDraft] = useState<CropRectN | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const selection = () => store.getState().selection;
  const docNow = () => store.getState().doc;
  const norm = (p: Point) => (view.current ? screenToNorm(view.current, p) : p);

  const componentHandles = useCallback((): { id: string; at: Point }[] => {
    const d = docNow();
    const id = selection();
    if (!d || !id) return [];
    const c = maskOfLayer(d, id)?.components[tools.get().component];
    if (!c) return [];
    if (c.kind === 'gradient' && tool === 'gradient')
      return [
        { id: 'from', at: c.from },
        { id: 'to', at: c.to },
      ];
    if (c.kind === 'radial' && tool === 'radial') {
      const rad = (c.rotate * Math.PI) / 180;
      const cs = Math.cos(rad);
      const sn = Math.sin(rad);
      const v = view.current;
      const asp = v ? v.imageW / v.imageH : 1;
      return [
        { id: 'center', at: c.center },
        { id: 'rx', at: { x: c.center.x + c.rx * cs, y: c.center.y + c.rx * sn * asp } },
        { id: 'ry', at: { x: c.center.x - (c.ry * sn) / asp, y: c.center.y + c.ry * cs } },
        {
          id: 'rot',
          at: { x: c.center.x + c.rx * 1.25 * cs, y: c.center.y + c.rx * 1.25 * sn * asp },
        },
      ];
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, revision]);

  const hitHandle = (p: Point, handles: { id: string; at: Point }[]) => {
    const v = view.current;
    if (!v) return null;
    for (const h of handles) {
      const s = normToScreen(v, h.at);
      if (Math.hypot(s.x - p.x, s.y - p.y) <= HIT) return h.id;
    }
    return null;
  };

  const cropRect = (): CropRectN => cropDraft ?? docNow()?.geometry.crop ?? FULL;
  const cropHandlePos = (r: CropRectN, h: CropHandle): Point => ({
    x: h.includes('w') ? r.x : h.includes('e') ? r.x + r.width : r.x + r.width / 2,
    y: h.includes('n') ? r.y : h.includes('s') ? r.y + r.height : r.y + r.height / 2,
  });
  const perspCorners = (d: PhotoDoc | null): Record<PerspectiveCorner, Point> => {
    const p = d?.geometry.perspective;
    return {
      tl: { x: p?.tl.x ?? 0, y: p?.tl.y ?? 0 },
      tr: { x: 1 + (p?.tr.x ?? 0), y: p?.tr.y ?? 0 },
      br: { x: 1 + (p?.br.x ?? 0), y: 1 + (p?.br.y ?? 0) },
      bl: { x: p?.bl.x ?? 0, y: 1 + (p?.bl.y ?? 0) },
    };
  };

  const moveHandle = (h: string, n: Point) => {
    const id = selection();
    const d = docNow();
    if (!id || !d) return;
    const idx = tools.get().component;
    const c = maskOfLayer(d, id)?.components[idx];
    if (!c) return;
    const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
    const q = { x: r4(n.x), y: r4(n.y) };
    let patch: Record<string, unknown> | null = null;
    if (c.kind === 'gradient' && (h === 'from' || h === 'to')) patch = { [h]: q };
    if (c.kind === 'radial') {
      const v = view.current;
      const asp = v ? v.imageW / v.imageH : 1;
      if (h === 'center') patch = { center: q };
      else if (h === 'rx')
        patch = {
          rx: Math.min(
            2,
            Math.max(0.005, r4(Math.hypot(n.x - c.center.x, (n.y - c.center.y) / asp))),
          ),
        };
      else if (h === 'ry')
        patch = {
          ry: Math.min(
            2,
            Math.max(0.005, r4(Math.hypot((n.x - c.center.x) * asp, n.y - c.center.y))),
          ),
        };
      else if (h === 'rot') patch = { rotate: handleAngle(c.center, n, asp) };
    }
    if (patch) mutate(store, 'mask', (dd) => updateComponent(dd, id, idx, patch as never));
  };

  const onStart = (p: Point) => {
    const v = view.current;
    const d = docNow();
    if (!v || !d) return;
    const n = norm(p);
    const t = tools.get().tool;
    if (t === 'gradient' || t === 'radial') {
      const h = hitHandle(p, componentHandles());
      if (h) {
        store.dispatch(photoActions.gestureBegan('mask'));
        drag.current = { kind: 'handle', handle: h };
      } else drag.current = { kind: t === 'gradient' ? 'gradient-new' : 'radial-new', a: n, b: n };
    } else if (t === 'brush') {
      const id = selection();
      if (!id) {
        depsRef.current.onRefused?.('no_layer');
        return;
      }
      const out = outputSizeOf(d, depsRef.current.sourceSize);
      const idx = brushIndexOf(d, id, tools.get().component);
      const comp = idx !== undefined ? maskOfLayer(d, id)?.components[idx] : undefined;
      const existing = comp?.kind === 'brush' ? depsRef.current.brushAlpha(comp.png) : null;
      session.current = beginBrush(out.width, out.height, existing, idx);
      drag.current = { kind: 'brush', pts: [n] };
    } else if (t === 'heal') drag.current = { kind: 'heal', pts: [n] };
    else if (t === 'crop') {
      const r = cropRect();
      const hit = CROP_HANDLES.find((h) => {
        const s = normToScreen(v, cropHandlePos(r, h));
        return Math.hypot(s.x - p.x, s.y - p.y) <= HIT;
      });
      const inside = n.x > r.x && n.x < r.x + r.width && n.y > r.y && n.y < r.y + r.height;
      if (hit || inside) drag.current = { kind: 'crop', handle: hit ?? 'move', a: n, rect0: r };
    } else if (t === 'perspective') {
      const cs = perspCorners(d);
      const c = CORNERS.find((k) => {
        const s = normToScreen(v, cs[k]);
        return Math.hypot(s.x - p.x, s.y - p.y) <= HIT;
      });
      if (c) {
        store.dispatch(photoActions.gestureBegan('perspective'));
        drag.current = { kind: 'persp', corner: c, a: n };
      }
    } else if (t === 'straighten') drag.current = { kind: 'line', a: n, b: n };
    rerender();
  };

  const onMove = (p: Point) => {
    const st = drag.current;
    const v = view.current;
    if (!st || !v) return;
    const n = norm(p);
    switch (st.kind) {
      case 'gradient-new':
      case 'radial-new':
      case 'line':
        st.b = n;
        break;
      case 'handle':
        moveHandle(st.handle, n);
        break;
      case 'brush':
      case 'heal':
        st.pts.push(n);
        break;
      case 'crop': {
        const d = docNow();
        if (!d) return;
        const t = tools.get();
        const src = depsRef.current.sourceSize;
        const canvas = outputSizeOf({ ...d, geometry: { ...d.geometry, crop: null } }, src);
        setCropDraft(
          dragCrop(
            st.rect0,
            st.handle,
            n.x - st.a.x,
            n.y - st.a.y,
            canvas.width,
            canvas.height,
            aspectValue(t.aspect, src.width, src.height),
          ),
        );
        break;
      }
      case 'persp': {
        const d = docNow();
        if (!d) return;
        const next = movePerspectiveCorner(
          d.geometry.perspective,
          st.corner,
          n.x - st.a.x,
          n.y - st.a.y,
        );
        st.a = n;
        mutate(store, 'perspective', (dd) =>
          patchGeometry(dd, { perspective: isZeroPerspective(next) ? null : next }),
        );
        break;
      }
    }
    rerender();
  };

  const onEnd = () => {
    const st = drag.current;
    drag.current = null;
    const d = docNow();
    const v = view.current;
    if (!st || !d || !v) return rerender();
    const id = selection();
    const dp = depsRef.current;
    switch (st.kind) {
      case 'handle':
      case 'persp':
        store.dispatch(photoActions.gestureEnded());
        break;
      case 'gradient-new':
      case 'radial-new': {
        if (!id) {
          dp.onRefused?.('no_layer');
          break;
        }
        const comp =
          st.kind === 'gradient-new' ? gradientComponent(st.a, st.b) : radialComponent(st.a, st.b);
        if (!comp) break;
        const before = maskOfLayer(d, id)?.components.length ?? 0;
        mutate(store, 'addMask', (dd) => addComponent(dd, id, comp));
        const after = maskOfLayer(docNow()!, id)?.components.length ?? 0;
        if (after > before) {
          tools.set({ component: after - 1 });
          dp.onMaskAdded?.(comp.kind as 'gradient' | 'radial');
        }
        break;
      }
      case 'brush': {
        const s = session.current;
        session.current = null;
        if (!s || !id) break;
        paintStroke(s, st.pts, tools.get().brush);
        const hadBrush = brushIndexOf(d, id, tools.get().component) !== undefined;
        void bakeInto(d, id, s, dp.encodePng).then((r) => {
          if (!r.ok) {
            if (r.reason !== 'no_layer')
              dp.onRefused?.(r.reason === 'full' ? 'brush_full' : 'brush_too_big');
            return;
          }
          dp.onBrushBaked?.(r.png, r.alpha);
          // Re-apply on the CURRENT doc (other edits may have landed while encoding).
          mutate(store, 'brush', (dd) =>
            setBrushComponent(
              dd,
              id,
              r.png,
              r.width,
              r.height,
              brushIndexOf(dd, id, tools.get().component),
            ),
          );
          if (!hadBrush) {
            const comps = maskOfLayer(docNow()!, id)?.components ?? [];
            tools.set({
              component: Math.max(
                0,
                comps.findIndex((c) => c.kind === 'brush'),
              ),
            });
            dp.onMaskAdded?.('brush');
          }
        });
        break;
      }
      case 'heal':
        dp.healStrokes.push({ pts: st.pts, size: tools.get().healSize });
        tools.set({ healStrokes: dp.healStrokes.length });
        break;
      case 'crop': {
        const draft = cropDraft;
        if (!draft) break;
        void applyCropRemap(d, draft, dp.encodePng, async (png) => dp.brushAlpha(png)).then(
          (next) => mutate(store, 'crop', () => next),
        );
        break;
      }
      case 'line': {
        const a = screenToImage(v, normToScreen(v, st.a));
        const b = screenToImage(v, normToScreen(v, st.b));
        if (Math.hypot(b.x - a.x, b.y - a.y) < 8) break;
        mutate(store, 'straighten', (dd) =>
          patchGeometry(dd, { rotate: straightenAngle(dd.geometry.rotate, a, b) }),
        );
        tools.set({ tool: 'none' });
        break;
      }
    }
    rerender();
  };

  const onTap = (p: Point, long: boolean) => {
    const d = docNow();
    const t = tools.get().tool;
    const dp = depsRef.current;
    if (!d) return;
    const n = norm(p);
    if (t === 'eyedropper') {
      const id = selection();
      if (!id) return dp.onRefused?.('no_layer');
      const rgb = dp.readPixel(n);
      if (!rgb) return;
      const before = maskOfLayer(d, id)?.components.length ?? 0;
      mutate(store, 'colourTarget', (dd) =>
        pickColorTarget(dd, id, tools.get().component, rgb, long),
      );
      const after = maskOfLayer(docNow()!, id)?.components.length ?? 0;
      if (after > before) {
        tools.set({ component: after - 1 });
        dp.onMaskAdded?.('colorRange');
      }
    } else if (t === 'redEye') {
      const out = outputSizeOf(d, dp.sourceSize);
      const r = redEyeAt(d, n, tools.get().redEyeRadius, out.width, out.height);
      if (r) mutate(store, 'redEye', () => r.doc, r.layerId);
    } else if (t === 'brush' || t === 'heal') {
      // A tap paints one dab.
      onStart(p);
      onEnd();
    }
  };

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(0)
      .onBegin((e) => onStart({ x: e.x, y: e.y }))
      .onUpdate((e) => onMove({ x: e.x, y: e.y }))
      .onFinalize(() => onEnd());
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(400)
      .onEnd((e) => onTap({ x: e.x, y: e.y }, false));
    const long = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(450)
      .onStart((e) => onTap({ x: e.x, y: e.y }, true));
    return ONE_FINGER_TOOLS.has(tool) ? pan : Gesture.Exclusive(long, tap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const overlay = (sv: SharedValue<ViewState>): ReactNode => {
    view.current = sv.value;
    const v = sv.value;
    if (!v || v.canvasW === 0) return null;
    const S = (n: Point) => normToScreen(v, n);
    const yellow = '#facc15';
    const handle = (key: string, at: Point) => {
      const s = S(at);
      return (
        <Group key={key}>
          <Circle cx={s.x} cy={s.y} r={11} color="rgba(0,0,0,0.45)" />
          <Circle cx={s.x} cy={s.y} r={9} color={yellow} style="stroke" strokeWidth={2.5} />
        </Group>
      );
    };
    const st = drag.current;
    const items: ReactNode[] = [];
    if (st && (st.kind === 'gradient-new' || st.kind === 'line')) {
      const a = S(st.a);
      const b = S(st.b);
      items.push(
        <Line key="l" p1={vec(a.x, a.y)} p2={vec(b.x, b.y)} color={yellow} strokeWidth={2} />,
      );
    }
    if (st && st.kind === 'radial-new') {
      const a = S(st.a);
      const b = S(st.b);
      const path = Skia.Path.Make();
      path.addOval(
        Skia.XYWHRect(
          a.x - Math.abs(b.x - a.x),
          a.y - Math.abs(b.y - a.y),
          2 * Math.abs(b.x - a.x),
          2 * Math.abs(b.y - a.y),
        ),
      );
      items.push(<Path key="o" path={path} color={yellow} style="stroke" strokeWidth={2} />);
    }
    if (st && (st.kind === 'brush' || st.kind === 'heal') && st.pts.length > 0) {
      const path = Skia.Path.Make();
      const p0 = S(st.pts[0]!);
      path.moveTo(p0.x, p0.y);
      for (const q of st.pts.slice(1)) {
        const s = S(q);
        path.lineTo(s.x, s.y);
      }
      // Diameter in source px → screen points (preview px = source px * preview scale).
      const out = outputSizeOf(docNow()!, depsRef.current.sourceSize);
      const k = (v.imageW / out.width) * v.scale;
      const width = Math.max(2, (st.kind === 'brush' ? brush.size : healSize) * k);
      items.push(
        <Path
          key="stroke"
          path={path}
          color={
            st.kind === 'heal'
              ? 'rgba(56,189,248,0.55)'
              : brush.erase
                ? 'rgba(255,255,255,0.5)'
                : 'rgba(239,68,68,0.5)'
          }
          style="stroke"
          strokeWidth={width}
          strokeCap="round"
          strokeJoin="round"
        />,
      );
    }
    if (tool === 'heal') {
      const out = outputSizeOf(docNow()!, depsRef.current.sourceSize);
      const k = (v.imageW / out.width) * v.scale;
      depsRef.current.healStrokes.forEach((s, i) => {
        const path = Skia.Path.Make();
        const p0 = S(s.pts[0]!);
        path.moveTo(p0.x, p0.y);
        for (const q of s.pts.slice(1)) path.lineTo(S(q).x, S(q).y);
        if (s.pts.length === 1) path.lineTo(p0.x + 0.1, p0.y);
        items.push(
          <Path
            key={`h${i}`}
            path={path}
            color="rgba(56,189,248,0.45)"
            style="stroke"
            strokeWidth={Math.max(2, s.size * k)}
            strokeCap="round"
            strokeJoin="round"
          />,
        );
      });
    }
    for (const h of componentHandles()) items.push(handle(h.id, h.at));
    if (tool === 'crop') {
      const r = cropRect();
      const a = S({ x: r.x, y: r.y });
      const b = S({ x: r.x + r.width, y: r.y + r.height });
      items.push(
        <Rect
          key="cr"
          x={a.x}
          y={a.y}
          width={b.x - a.x}
          height={b.y - a.y}
          color={yellow}
          style="stroke"
          strokeWidth={2}
        />,
      );
      for (let i = 1; i < 3; i += 1) {
        const gx = a.x + ((b.x - a.x) * i) / 3;
        const gy = a.y + ((b.y - a.y) * i) / 3;
        items.push(
          <Line
            key={`gx${i}`}
            p1={vec(gx, a.y)}
            p2={vec(gx, b.y)}
            color="rgba(255,255,255,0.4)"
            strokeWidth={1}
          />,
        );
        items.push(
          <Line
            key={`gy${i}`}
            p1={vec(a.x, gy)}
            p2={vec(b.x, gy)}
            color="rgba(255,255,255,0.4)"
            strokeWidth={1}
          />,
        );
      }
      for (const h of CROP_HANDLES) items.push(handle(`c${h}`, cropHandlePos(r, h)));
    }
    if (tool === 'straighten' || tool === 'crop') {
      // Grid overlay for judging level lines.
      const a = S({ x: 0, y: 0 });
      const b = S({ x: 1, y: 1 });
      if (tool === 'straighten')
        for (let i = 1; i < 6; i += 1) {
          const gx = a.x + ((b.x - a.x) * i) / 6;
          const gy = a.y + ((b.y - a.y) * i) / 6;
          items.push(
            <Line
              key={`sx${i}`}
              p1={vec(gx, a.y)}
              p2={vec(gx, b.y)}
              color="rgba(255,255,255,0.3)"
              strokeWidth={1}
            />,
          );
          items.push(
            <Line
              key={`sy${i}`}
              p1={vec(a.x, gy)}
              p2={vec(b.x, gy)}
              color="rgba(255,255,255,0.3)"
              strokeWidth={1}
            />,
          );
        }
    }
    if (tool === 'perspective') {
      const cs = perspCorners(docNow());
      const path = Skia.Path.Make();
      CORNERS.forEach((c, i) => {
        const s = S(cs[c]);
        if (i === 0) path.moveTo(s.x, s.y);
        else path.lineTo(s.x, s.y);
      });
      path.close();
      items.push(<Path key="pq" path={path} color={yellow} style="stroke" strokeWidth={1.5} />);
      for (const c of CORNERS) items.push(handle(`p${c}`, cs[c]));
    }
    return <Group>{items}</Group>;
  };

  const d = docNow();
  return {
    active: ONE_FINGER_TOOLS.has(tool) || tool === 'eyedropper' || tool === 'redEye',
    gesture,
    maskView,
    viewLayerId: maskView === 'off' ? null : d ? selection() : null,
    ignoreCrop: tool === 'crop' || tool === 'perspective',
    overlay,
    revision,
  };
}
