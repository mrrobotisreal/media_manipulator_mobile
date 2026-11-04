import { editorHref } from '@/photo/openRequest';
import type { RemoteMessage } from './messaging';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const isJobId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export interface PushJob {
  jobId: string;
  tool: string;
  status: 'completed' | 'failed';
}

export interface PushText {
  title?: string;
  body?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** `data {jobId, tool, status, url}` from MA23. Null when `jobId` is not a UUID (never routed). */
export function parsePush(message: Pick<RemoteMessage, 'data'> | null | undefined): PushJob | null {
  const data = message?.data;
  const jobId = str(data?.jobId);
  if (!isJobId(jobId)) return null;
  const tool = str(data?.tool);
  return {
    jobId: jobId.toLowerCase(),
    tool: tool && TOOL.test(tool) ? tool : 'unknown',
    status: str(data?.status) === 'failed' ? 'failed' : 'completed',
  };
}

export const jobHref = (jobId: string) => `/(app)/job/${jobId}` as const;
/** MA56: an Aperture heal's push opens its project in the editor, which resumes the heal. */
export const PHOTO_HEAL_TOOL = 'photo_heal';
export const TOOLS_HREF = '/(app)/(tabs)' as const;

/**
 * Holds one pending destination until the `(app)` gate is ready (signed in and synced), then flushes it.
 * A tap that arrives while the account is still syncing is queued, never dropped.
 */
export function createRouteQueue(navigate: (href: string) => void) {
  let ready = false;
  let pending: string | null = null;
  const flush = () => {
    if (ready && pending) {
      const href = pending;
      pending = null;
      navigate(href);
    }
  };
  return {
    push(href: string) {
      pending = href;
      flush();
    },
    setReady(value: boolean) {
      ready = value;
      flush();
    },
    pending: () => pending,
  };
}

export type OpenedState = 'background' | 'quit' | 'foreground';

export interface HandlerDeps {
  /** The job id of the open `/job/<id>` screen, or null. */
  currentJobId(): string | null;
  /** `open` is the toast's "Open" action (routes and tracks `push_opened` with `app_state: foreground`). */
  showToast(t: { jobId: string; title?: string; body?: string; open: () => void }): void;
  /** Foreground arrival: refetch that job and invalidate History/Account. */
  refresh(jobId: string): void;
  route(href: string): void;
  trackOpened(p: PushJob & { app_state: OpenedState }): void;
  /** MA56: a `photo_heal` job's project id (the phone's pending record, else the job), or null. */
  healProject?(jobId: string): Promise<string | null>;
  /** MA56: the project id of the open editor (`/photo/<id>`), or null. */
  currentPhotoProjectId?(): string | null;
}

export function createPushHandlers(deps: HandlerDeps) {
  /** A heal's project, or null when it is not one (or cannot be resolved). */
  const healProjectOf = async (job: PushJob): Promise<string | null> => {
    if (job.tool !== PHOTO_HEAL_TOOL || !deps.healProject) return null;
    try {
      return await deps.healProject(job.jobId);
    } catch {
      return null;
    }
  };
  /** `/job/<id>`, or for a heal its editor (none when that editor is already open: it resumes). */
  const open = (job: PushJob): void => {
    if (job.tool !== PHOTO_HEAL_TOOL || !deps.healProject) {
      deps.route(jobHref(job.jobId));
      return;
    }
    void healProjectOf(job).then((projectId) => {
      if (!projectId) deps.route(jobHref(job.jobId));
      else if (deps.currentPhotoProjectId?.() !== projectId) deps.route(editorHref(projectId));
    });
  };
  const api = {
    /** `onMessage`: no system notification in the foreground. */
    onForeground(message: RemoteMessage): void {
      const job = parsePush(message);
      if (!job) return;
      deps.refresh(job.jobId);
      // On that job's own screen the live job already updates: do nothing.
      if (deps.currentJobId() === job.jobId) return;
      const toast = () =>
        deps.showToast({
          jobId: job.jobId,
          title: message.notification?.title,
          body: message.notification?.body,
          open: () => api.onToastOpen(message),
        });
      if (job.tool !== PHOTO_HEAL_TOOL || !deps.currentPhotoProjectId?.()) return toast();
      // A heal whose editor is open: the editor installs it, no toast.
      void healProjectOf(job).then((projectId) => {
        if (!projectId || deps.currentPhotoProjectId?.() !== projectId) toast();
      });
    },
    /** Toast "Open". */
    onToastOpen(message: RemoteMessage): void {
      const job = parsePush(message);
      if (!job) return;
      deps.trackOpened({ ...job, app_state: 'foreground' });
      open(job);
    },
    /** `onNotificationOpenedApp` (background) and `getInitialNotification` (quit). */
    onOpened(message: RemoteMessage, appState: 'background' | 'quit'): void {
      const job = parsePush(message);
      if (!job) {
        deps.route(TOOLS_HREF);
        return;
      }
      deps.trackOpened({ ...job, app_state: appState });
      open(job);
    },
  };
  return api;
}
