/**
 * DEVELOPMENT ONLY (ticket MA62 S4): a screen that mounts `<StudioPreview>` on a Darkroom project
 * from the signed-in account's Projects list, to exercise the preview engine on a device before
 * the editor (MA63) exists. Reached only through `app/(app)/dev/darkroom-preview.tsx`, which
 * renders nothing (a redirect) unless `__DEV__`; no production screen links to it.
 *
 * Controls: a project picker (the account's Darkroom projects), play / pause, a scrub bar (pauses,
 * exact seeks), the safe-mode toggle, and an fps / slots readout in an isolated component that
 * re-renders itself once a second (MA76 rule 4: the canvas scene never re-renders for stats).
 *
 * The dev UI copy is not user-facing (development builds only) and stays English; the preview's
 * own chips ("Simplified preview", "Approximate preview") go through `t()` like in production.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { Button, Text } from '@/ui/components';
import { useAppDispatch } from '@/state/hooks';
import { useListStudioProjectsQuery } from '../../api';
import { studioMediaCache } from '../../assetsRuntime';
import { studioSessionApiFor } from '../../sessionApi';
import { makeStudioStore, studioActions, type StudioStore } from '../../studioStore';
import { createPoolMedia } from '../../skia/poolMedia';
import { previewDuration } from '../../skia/previewController';
import { StudioPreview, useStudioPreviewController, type StudioPreviewHandle } from '../../skia/StudioPreview';


export function PreviewDevScreen() {
  const dispatch = useAppDispatch();
  const list = useListStudioProjectsQuery();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [store, setStore] = useState<StudioStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    const api = studioSessionApiFor(dispatch as never);
    void (async () => {
      setError(null);
      const [proj, assets] = await Promise.all([api.getProject(projectId), api.listAssets(projectId)]);
      if (cancelled) return;
      if (!proj.ok) {
        setError(`project: ${proj.error.code}`);
        return;
      }
      const s = makeStudioStore();
      s.dispatch(studioActions.loaded({ projectId, doc: proj.value, serverRevision: proj.value.revision ?? null }));
      if (assets.ok) s.dispatch(studioActions.assetsSet(assets.value));
      setStore(s);
    })();
    return () => {
      cancelled = true;
      setStore(null);
    };
  }, [projectId, dispatch]);

  if (!projectId || !store) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 8 }}>
        <Text className="text-lg font-semibold text-foreground">Darkroom preview (dev)</Text>
        {error && <Text className="text-danger">{error}</Text>}
        {projectId && !error && <Text className="text-muted-fg">Loading…</Text>}
        {(list.data ?? []).map((p) => (
          <Pressable key={p.id} onPress={() => setProjectId(p.id)} style={{ paddingVertical: 12 }} accessibilityRole="button">
            <Text className="text-foreground">
              {p.name} · {p.width}x{p.height} · {Math.round(p.durationSeconds)} s
            </Text>
          </Pressable>
        ))}
        {list.isFetching && <Text className="text-muted-fg">Loading projects…</Text>}
      </ScrollView>
    );
  }
  return <DevPreview store={store} onBack={() => setProjectId(null)} />;
}

function DevPreview({ store, onBack }: { store: StudioStore; onBack: () => void }) {
  const { t } = useTranslation();
  const controller = useStudioPreviewController();
  const media = useMemo(() => createPoolMedia(() => store.getState().assets, studioMediaCache), [store]);
  const duration = previewDuration(store.getState().doc?.tracks ?? []);
  const scrubW = useRef(1);
  const [playing, setPlaying] = useState(false);

  const scrub = (e: GestureResponderEvent) => {
    const c = controller.current;
    if (!c) return;
    if (c.isPlaying) {
      c.pause();
      setPlaying(false);
    }
    const x = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubW.current));
    c.seek(x * duration);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 40 }}>
      <View style={{ width: '100%', aspectRatio: 16 / 9 }}>
        <StudioPreview
          store={store}
          media={media}
          controller={controller}
          overlay={({ safe }) => (
            <View style={{ position: 'absolute', top: 8, start: 8, gap: 4 }} pointerEvents="none">
              {safe && <Chip label={t('darkroom.preview.simplified')} />}
              {(store.getState().doc?.captions?.length ?? 0) > 0 && <Chip label={t('darkroom.preview.approximate')} />}
            </View>
          )}
        />
      </View>
      <View
        style={{ height: 44, backgroundColor: '#222', marginTop: 8 }}
        onLayout={(e) => (scrubW.current = e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={scrub}
        onResponderMove={scrub}
      >
        <Text className="p-3 text-muted-fg">scrub (pauses)</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, padding: 8 }}>
        <Button
          label={playing ? 'Pause' : 'Play'}
          onPress={() => {
            const c = controller.current;
            if (!c) return;
            if (c.isPlaying) c.pause();
            else c.play();
            setPlaying(c.isPlaying);
          }}
        />
        <SafeToggle controller={controller} />
        <Button label="Back" variant="secondary" onPress={onBack} />
      </View>
      <LiveStats controller={controller} duration={duration} />
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text className="text-xs text-foreground">{label}</Text>
    </View>
  );
}

function SafeToggle({ controller }: { controller: { current: StudioPreviewHandle | null } }) {
  const [on, setOn] = useState(false);
  return (
    <Button
      label={on ? 'Safe mode: on' : 'Safe mode: off'}
      variant="secondary"
      onPress={() => {
        const c = controller.current;
        if (!c) return;
        c.setSafeMode(!c.safeMode);
        setOn(c.safeMode);
      }}
    />
  );
}

/** Isolated 1 Hz readout: re-renders only itself (MA76 rule 4). */
function LiveStats({ controller, duration }: { controller: { current: StudioPreviewHandle | null }; duration: number }) {
  const [s, setS] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const c = controller.current;
      if (!c) return;
      setS(`t=${c.t.toFixed(2)} / ${duration.toFixed(1)} s · fps=${c.fps.toFixed(1)} · slots=${c.slots} · safe=${c.safeMode ? 'on' : 'off'}`);
    }, 1000);
    return () => clearInterval(id);
  }, [controller, duration]);
  return <Text className="px-2 font-mono text-xs text-muted-fg">{s}</Text>;
}
