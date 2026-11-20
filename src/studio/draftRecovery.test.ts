// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/draftRecovery.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import type { StudioClip, StudioProject, StudioTrack } from './studioTypes';
import type { StudioDraft } from './mobile/drafts';
import {
  deepEqual,
  documentsEqual,
  evaluateDraft,
  formatRelativeTime,
  summarizeDraftChanges,
} from './draftRecovery';

const clip = (id: string, over: Partial<StudioClip> = {}): StudioClip => ({
  id,
  assetId: 'asset-1',
  streamIndex: 0,
  timelineStart: 0,
  sourceIn: 0,
  sourceOut: 5,
  ...over,
});

const track = (id: string, clips: StudioClip[] = [], over: Partial<StudioTrack> = {}): StudioTrack => ({
  id,
  kind: 'video',
  index: 0,
  muted: false,
  clips,
  ...over,
});

const project = (over: Partial<StudioProject> = {}): StudioProject => ({
  id: 'p1',
  name: 'Test project',
  schemaVersion: 3,
  fps: 30,
  width: 1920,
  height: 1080,
  durationSeconds: 5,
  tracks: [track('v1', [clip('c1')]), track('a1', [], { kind: 'audio' })],
  captions: [],
  captionsEnabled: true,
  revision: 5,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-05T10:00:00Z',
  ...over,
});

const SERVER_UPDATED_MS = Date.parse('2026-08-05T10:00:00Z');

const draftOf = (server: StudioProject, over: Partial<StudioDraft> = {}): StudioDraft => ({
  projectId: server.id,
  baseRevision: server.revision ?? null,
  savedAt: SERVER_UPDATED_MS + 60_000,
  document: structuredClone(server),
  ...over,
});

/** A draft whose document meaningfully differs from `server`. */
const editedDraft = (server: StudioProject, over: Partial<StudioDraft> = {}): StudioDraft => {
  const doc = structuredClone(server);
  doc.tracks[0].clips.push(clip('c-new', { timelineStart: 10 }));
  return draftOf(server, { document: doc, ...over });
};

describe('deepEqual', () => {
  it('ignores object key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('treats explicit undefined like an absent key (structured clone vs zod parse)', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });

  it('compares arrays by position', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
  });

  it('detects nested differences', () => {
    expect(deepEqual({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('documentsEqual', () => {
  it('ignores server-authoritative metadata (revision / updatedAt / duration)', () => {
    const a = project();
    const b = project({ revision: 99, updatedAt: '2026-08-05T12:00:00Z', durationSeconds: 42 });
    expect(documentsEqual(a, b)).toBe(true);
  });

  it('sees edits to tracks', () => {
    const a = project();
    const b = project();
    b.tracks[0].clips[0] = clip('c1', { timelineStart: 3 });
    expect(documentsEqual(a, b)).toBe(false);
  });
});

describe('evaluateDraft — decision matrix', () => {
  const server = project();

  it('discards a draft not newer than the server copy (older and equal timestamps)', () => {
    expect(evaluateDraft(editedDraft(server, { savedAt: SERVER_UPDATED_MS - 1 }), server)).toBe('discard');
    expect(evaluateDraft(editedDraft(server, { savedAt: SERVER_UPDATED_MS }), server)).toBe('discard');
  });

  it('discards a newer draft whose document does not differ', () => {
    expect(evaluateDraft(draftOf(server), server)).toBe('discard');
  });

  it('offers clean recovery when the base revision matches the server revision', () => {
    expect(evaluateDraft(editedDraft(server, { baseRevision: 5 }), server)).toBe('recover');
  });

  it('routes an older base revision to the conflict path (saved elsewhere after the draft)', () => {
    expect(evaluateDraft(editedDraft(server, { baseRevision: 4 }), server)).toBe('conflict');
  });

  it('routes a newer base revision to the conflict path too (anomalous — never silently apply)', () => {
    expect(evaluateDraft(editedDraft(server, { baseRevision: 6 }), server)).toBe('conflict');
  });

  it('falls back to clean recovery when revisions are unknown (legacy backend)', () => {
    const legacyServer = project({ revision: undefined });
    expect(evaluateDraft(editedDraft(legacyServer, { baseRevision: null }), legacyServer)).toBe('recover');
    // Only one side knows a revision → nothing to compare → timestamps decide.
    expect(evaluateDraft(editedDraft(legacyServer, { baseRevision: 5 }), legacyServer)).toBe('recover');
    expect(evaluateDraft(editedDraft(server, { baseRevision: null }), server)).toBe('recover');
  });

  it('discards when the server timestamp is newer even if revisions match', () => {
    const d = editedDraft(server, { baseRevision: 5, savedAt: SERVER_UPDATED_MS - 5000 });
    expect(evaluateDraft(d, server)).toBe('discard');
  });
});

describe('summarizeDraftChanges', () => {
  it('reports no changes for identical documents', () => {
    const s = project();
    expect(summarizeDraftChanges(s, structuredClone(s))).toEqual({
      tracksAdded: 0,
      tracksRemoved: 0,
      clipsAdded: 0,
      clipsRemoved: 0,
      clipsChanged: 0,
      captionsChanged: false,
      otherChanges: false,
    });
  });

  it('counts added and removed clips across all tracks', () => {
    const s = project();
    const d = structuredClone(s);
    d.tracks[0].clips = [clip('c2', { timelineStart: 1 }), clip('c3', { timelineStart: 2 })];
    const summary = summarizeDraftChanges(s, d);
    expect(summary.clipsAdded).toBe(2);
    expect(summary.clipsRemoved).toBe(1);
    expect(summary.clipsChanged).toBe(0);
  });

  it('counts an edited clip (same id, different fields) as changed', () => {
    const s = project();
    const d = structuredClone(s);
    d.tracks[0].clips[0] = clip('c1', { timelineStart: 7 });
    const summary = summarizeDraftChanges(s, d);
    expect(summary.clipsChanged).toBe(1);
    expect(summary.clipsAdded).toBe(0);
    expect(summary.clipsRemoved).toBe(0);
  });

  it('does not count a clip moved between tracks as added/removed', () => {
    const s = project({
      tracks: [track('v1', [clip('c1')]), track('v2', [], { index: 1 })],
    });
    const d = structuredClone(s);
    d.tracks[1].clips = d.tracks[0].clips;
    d.tracks[0].clips = [];
    const summary = summarizeDraftChanges(s, d);
    expect(summary.clipsAdded).toBe(0);
    expect(summary.clipsRemoved).toBe(0);
    expect(summary.clipsChanged).toBe(0);
  });

  it('counts added and removed tracks', () => {
    const s = project();
    const d = structuredClone(s);
    d.tracks = [d.tracks[0], track('v2', [], { index: 1 })]; // drop a1, add v2
    const summary = summarizeDraftChanges(s, d);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.tracksRemoved).toBe(1);
  });

  it('flags caption and project-settings changes', () => {
    const s = project();
    const withCaptions = structuredClone(s);
    withCaptions.captions = [{ id: 'cue1', startSeconds: 0, endSeconds: 1, text: 'hi' }];
    expect(summarizeDraftChanges(s, withCaptions).captionsChanged).toBe(true);

    const renamed = structuredClone(s);
    renamed.name = 'Renamed';
    const summary = summarizeDraftChanges(s, renamed);
    expect(summary.otherChanges).toBe(true);
    expect(summary.captionsChanged).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);

  it('formats seconds / minutes / hours / days in the past', () => {
    expect(formatRelativeTime(now - 30_000, now)).toMatch(/second|now/i);
    expect(formatRelativeTime(now - 5 * 60_000, now)).toMatch(/minute/i);
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toMatch(/hour/i);
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toMatch(/day/i);
  });

  it('reads naturally at the "just now" boundary', () => {
    expect(formatRelativeTime(now, now)).toMatch(/now/i);
  });
});
