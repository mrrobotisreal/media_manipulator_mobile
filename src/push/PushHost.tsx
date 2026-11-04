import { useRouter, usePathname, useRootNavigationState, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { jobsApi } from '@/api/endpoints/jobs';
import { mmApi } from '@/api/mmApi';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { resolveHealProject } from '@/photo/healPending';
import { NEW_PROJECT } from '@/photo/openRequest';
import { mmkvStorage } from '@/state/persist';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import type { TFunction } from 'i18next';
import type { JobsState } from '@/state/slices/jobs';
import type { AppDispatch } from '@/state/store';
import { showNotice } from '@/ui/notice';
import { ensureJobUpdatesChannel } from './channel';
import { createPushHandlers, createRouteQueue, isJobId } from './handlers';
import { pushMessaging } from './messaging';
import { getPermissionState } from './permission';
import { checkLongJobPrompt, earliestRunning } from './prePrompt';
import { PrePromptSheet } from './PrePromptSheet';
import { askForPush } from './promptFlow';
import { bindPushDispatch, tokenManager } from './runtime';

let navigateRef: ((href: string) => void) | null = null;
/** Module-level so a tap that lands before the tree mounts is still queued, never dropped. */
const queue = createRouteQueue((href) => navigateRef?.(href));

interface Ctx {
  pathname: string;
  jobs: JobsState;
  dismissedAt: number | null;
  t: TFunction;
  dispatch: AppDispatch;
}
/** Latest render's values for callbacks that outlive a render (written in an effect). */
let ctx: Ctx | null = null;
const EMPTY_JOBS: JobsState = { byLocalId: {}, order: [], byJobId: {} };

const handlers = createPushHandlers({
  currentJobId: () => {
    const id = JOB_PATH.exec(ctx?.pathname ?? '')?.[1];
    return id && isJobId(id) ? id.toLowerCase() : null;
  },
  showToast: ({ title, body, open }) => {
    if (!ctx) return;
    const tr = ctx.t;
    const text = [title, body].filter(Boolean).join(' - ') || tr('push.toast.fallback');
    showNotice(text, 'info', { label: tr('push.toast.open'), onPress: open });
  },
  refresh: (jobId) => {
    void ctx?.dispatch(jobsApi.util.invalidateTags([{ type: 'Job', id: jobId }]));
    ctx?.dispatch(mmApi.util.invalidateTags(['History', 'Account']));
  },
  route: (href) => queue.push(href),
  trackOpened: (p) =>
    track(EVENTS.PUSH_OPENED, { tool: p.tool, status: p.status, app_state: p.app_state }),
  // MA56: a heal's project from the phone's pending record, else the job's `options.projectId`.
  healProject: (jobId) =>
    resolveHealProject(mmkvStorage, jobId, async (id) => {
      if (!ctx) throw new Error('push host not mounted');
      const job = await ctx
        .dispatch(jobsApi.endpoints.getJob.initiate(id, { subscribe: false, forceRefetch: true }))
        .unwrap();
      return { options: job.options };
    }),
  currentPhotoProjectId: () => {
    const id = PHOTO_PATH.exec(ctx?.pathname ?? '')?.[1];
    if (!id) return null;
    const decoded = decodeURIComponent(id);
    return decoded === NEW_PROJECT ? null : decoded;
  },
});

const JOB_PATH = /\/job\/([^/?#]+)/;
const PHOTO_PATH = /\/photo\/([^/?#]+)/;

/**
 * Mounted once under the auth gate (after `startAuth`, MA24 `initPush`). Creates the channel, registers
 * the token once the account is synced (every cold start, token refresh, language change), shows the
 * pre-prompt at the first ~20 s job, and routes notification taps to `/job/<id>`.
 */
export function PushHost() {
  const { t } = useTranslation();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const locale = useActiveLocale();
  const ready = useAppSelector((s) => s.auth.status === 'ready');
  const pathname = usePathname();
  const navReady = Boolean(useRootNavigationState()?.key);
  const jobs = useAppSelector((s) => s.jobs);
  const dismissedAt = useAppSelector((s) => s.settings.pushPrePromptDismissedAt);

  const busy = useRef(false);
  useEffect(() => {
    ctx = { pathname, jobs, dismissedAt, t, dispatch };
    navigateRef = (href) => router.push(href as Href);
  });

  useEffect(() => bindPushDispatch(dispatch), [dispatch]);

  // Taps wait for the (app) gate AND the navigator.
  useEffect(() => queue.setReady(ready && navReady), [ready, navReady]);

  // Channel (Android) in the active language; re-run renames it on a language change.
  useEffect(() => {
    void ensureJobUpdatesChannel(t('push.channelName'));
  }, [t, locale]);

  // Token: after sync, every cold start, and after a language change (the locale field).
  useEffect(() => {
    if (!ready) return;
    void tokenManager.sync();
  }, [ready, locale]);

  useEffect(() => {
    if (!ready) return;
    return pushMessaging.onTokenRefresh((token) => void tokenManager.onRefresh(token));
  }, [ready]);

  // Foreground messages, background taps and the cold-start tap.
  useEffect(() => {
    const offMessage = pushMessaging.onMessage((m) => handlers.onForeground(m));
    const offOpened = pushMessaging.onNotificationOpenedApp((m) =>
      handlers.onOpened(m, 'background'),
    );
    void pushMessaging.getInitialNotification().then((m) => {
      if (m) handlers.onOpened(m, 'quit');
    });
    return () => {
      offMessage();
      offOpened();
    };
  }, []);

  // Long-job pre-prompt: a timer from the earliest running job's 20 s mark, re-checked on foreground.
  const earliest = useAppSelector((st) =>
    earliestRunning(
      st.jobs.order.flatMap((id) => (st.jobs.byLocalId[id] ? [st.jobs.byLocalId[id]] : [])),
    ),
  );
  useEffect(() => {
    if (!ready || earliest === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const run = async () => {
      if (cancelled || busy.current) return;
      busy.current = true;
      try {
        const r = await checkLongJobPrompt({
          jobs: () => {
            const j = ctx?.jobs ?? EMPTY_JOBS;
            return j.order.flatMap((id) => (j.byLocalId[id] ? [j.byLocalId[id]] : []));
          },
          now: () => Date.now(),
          active: () => AppState.currentState === 'active',
          permission: () => getPermissionState(),
          dismissedAt: () => ctx?.dismissedAt ?? null,
          prompt: () => askForPush(dispatch, 'long_job'),
        });
        if (r.action === 'wait' && !cancelled) timer = setTimeout(() => void run(), r.ms + 50);
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void run());
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [ready, earliest, dispatch]);

  return <PrePromptSheet />;
}
