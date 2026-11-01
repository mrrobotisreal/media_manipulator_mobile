/* eslint-disable @typescript-eslint/no-require-imports */
import type { Mp3Deps } from './mp3';
import type { DeleteDeps } from './deleteJob';
import type { ShareDeps } from './shareLink';

/**
 * Real RTK Query / clipboard bindings for the share, MP3 and delete flows. Required lazily so the pure modules
 * (and their tests) never import the store.
 */
function api() {
  const { store } = require('@/state/store') as typeof import('@/state/store');
  const { jobsApi } = require('@/api/endpoints/jobs') as typeof import('@/api/endpoints/jobs');
  const { mmApi } = require('@/api/mmApi') as typeof import('@/api/mmApi');
  const { findJob, jobRemoved } =
    require('@/state/slices/jobs') as typeof import('@/state/slices/jobs');
  const { evictResult, evictOriginal } = require('./cache') as typeof import('./cache');
  return { store, jobsApi, mmApi, findJob, jobRemoved, evictResult, evictOriginal };
}

export function realShareDeps(): ShareDeps {
  const { store, jobsApi } = api();
  return {
    create: (id) => store.dispatch(jobsApi.endpoints.createShare.initiate(id)).unwrap(),
    revoke: (id) => store.dispatch(jobsApi.endpoints.revokeShares.initiate(id)).unwrap(),
    copy: async (text) => {
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await Clipboard.setStringAsync(text);
    },
  };
}

export function realMp3Deps(): Mp3Deps {
  const { store, jobsApi } = api();
  return {
    start: (id) => store.dispatch(jobsApi.endpoints.startMp3.initiate(id)).unwrap(),
    poll: (id) => store.dispatch(jobsApi.endpoints.pollMp3.initiate(id)).unwrap(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  };
}

export function realDeleteDeps(): DeleteDeps {
  const { store, jobsApi, mmApi, findJob, jobRemoved, evictResult, evictOriginal } = api();
  return {
    remove: (id) => store.dispatch(jobsApi.endpoints.deleteJob.initiate(id)).unwrap(),
    evictResult,
    evictOriginal,
    removeRecord: (id) => {
      const rec = findJob(store.getState().jobs, id);
      if (rec) store.dispatch(jobRemoved(rec.localId));
    },
    invalidate: () => void store.dispatch(mmApi.util.invalidateTags(['History', 'Account'])),
  };
}
