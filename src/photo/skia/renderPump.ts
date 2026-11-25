/**
 * The canvas's render loop on react-native-skia 3 (MA60), where a render is async (a dehaze layer
 * awaits a GPU readback). Latest wins: at most ONE render is in flight; document changes that land
 * meanwhile collapse into one pending pass that renders whatever the document is by then, so a
 * slider drag never stacks renders. A failed render is reported (the caller passes the app's
 * `client_error` path) once per document and retried up to `maxAttempts`; a later document change
 * tries again. Pure: the document source, the render, the publish and the report are injected.
 */
export interface RenderPumpDeps<D, R> {
  get: () => D | null;
  render: (doc: D) => Promise<R>;
  publish: (result: R, doc: D) => void;
  report: (error: unknown) => void;
  maxAttempts?: number;
}

export interface RenderPump {
  /** A document changed (or the first draw): render the latest, coalescing with any in flight. */
  request(): void;
  /** Unmounted: nothing publishes after this. */
  stop(): void;
}

export const MAX_RENDER_ATTEMPTS = 2;

export function createRenderPump<D, R>(deps: RenderPumpDeps<D, R>): RenderPump {
  const maxAttempts = deps.maxAttempts ?? MAX_RENDER_ATTEMPTS;
  let alive = true;
  let running = false;
  let again = false;
  let shown: D | null = null;
  let failed: D | null = null;
  let failures = 0;

  const pump = async () => {
    running = true;
    try {
      do {
        again = false;
        const d = deps.get();
        if (!d || d === shown) continue;
        if (d === failed && failures >= maxAttempts) continue;
        try {
          const r = await deps.render(d);
          if (!alive) return;
          // Published even when the document moved on meanwhile: it is newer than what is shown,
          // and the loop renders the latest next.
          deps.publish(r, d);
          shown = d;
          failed = null;
          failures = 0;
        } catch (e) {
          if (!alive) return;
          if (failed !== d) {
            failed = d;
            failures = 0;
            try {
              deps.report(e);
            } catch {
              // reporting never breaks the loop
            }
          }
          failures += 1;
          if (failures < maxAttempts) again = true;
        }
      } while (again && alive);
    } finally {
      running = false;
    }
  };

  return {
    request() {
      if (!alive) return;
      if (running) {
        again = true;
        return;
      }
      void pump();
    },
    stop() {
      alive = false;
    },
  };
}
