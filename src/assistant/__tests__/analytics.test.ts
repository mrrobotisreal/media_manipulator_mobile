import fs from 'node:fs';
import path from 'node:path';
import catalog from '../../../__fixtures__/analytics-catalog.fixture.json';
import { EVENTS, EVENT_PRIORITY } from '@/analytics/events';
import { answerOutcome, failReason, latencyBucket, turnIndexBucket } from '../analytics';
import { assistantApi, guideEnabled } from '@/api/endpoints/assistant';
import { assistantCapabilitiesSchema } from '@/api/schemas/assistant';

const cat = catalog as unknown as Record<string, { priority: number; props: string[] }>;
const BATCH = [
  'assistant_opened',
  'assistant_message_sent',
  'assistant_response_completed',
  'assistant_response_failed',
  'assistant_action_clicked',
  'assistant_link_clicked',
  'assistant_feedback_given',
];

describe('MA54 analytics mirror', () => {
  it('mirrors exactly the catalog batch "MA54 assistant guide" with catalog priorities', () => {
    const mine = Object.values(EVENTS).filter((n) => n.startsWith('assistant_'));
    expect([...mine].sort()).toEqual([...BATCH].sort());
    for (const n of BATCH) {
      expect(cat[n]).toBeDefined();
      expect(EVENT_PRIORITY[n as keyof typeof EVENT_PRIORITY]).toBe(cat[n]!.priority);
    }
  });

  it('every property the app sends is a catalog KnownProp (the copilot-only ones are never declared)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../analytics/events.ts'), 'utf8');
    const ifaces: Record<string, string[]> = {};
    for (const m of src.matchAll(/export interface (Assistant\w+Props) \{([\s\S]*?)\n\}/g)) {
      ifaces[m[1]!] = [...m[2]!.matchAll(/^\s+([a-z_]+)\??:/gm)].map((k) => k[1]!);
    }
    const map = /export interface EventPropsMap \{([\s\S]*?)\n\}/.exec(src)![1]!;
    for (const m of map.matchAll(/^\s+(assistant_[a-z_]+): (\w+);/gm)) {
      for (const k of ifaces[m[2]!]!)
        expect([m[1], cat[m[1]!]!.props]).toEqual([m[1], expect.arrayContaining([k])]);
    }
  });

  it('buckets match the web vocabulary', () => {
    expect([0, 1, 2, 3, 4, 10, 11].map(turnIndexBucket)).toEqual([
      '1',
      '1',
      '2-3',
      '2-3',
      '4-10',
      '4-10',
      '11+',
    ]);
    expect([0, 999, 1000, 2999, 3000, 9999, 10000, 29999, 30000].map(latencyBucket)).toEqual([
      '<1s',
      '<1s',
      '1-3s',
      '1-3s',
      '3-10s',
      '3-10s',
      '10-30s',
      '10-30s',
      '30s+',
    ]);
  });

  it('failure reasons map into the catalog enum', () => {
    const allowed = [
      'upstream',
      'timeout',
      'paused',
      'rate_limited',
      'sign_in',
      'aborted',
      'error',
    ];
    for (const c of [
      'upstream',
      'tool_limit',
      'network',
      'assistant_paused',
      'rate_limited',
      'sign_in_required',
      'aborted',
      'timeout',
      'http_500',
      'invalid_body',
    ]) {
      expect(allowed).toContain(failReason(c));
    }
    expect(failReason('assistant_paused')).toBe('paused');
    expect(failReason('sign_in_required')).toBe('sign_in');
    expect(failReason('http_500')).toBe('error');
  });

  it('outcomes: done.outcome wins, then ask, action, text', () => {
    expect(answerOutcome({ outcome: 'static' }, { action: true, ask: true })).toBe('static');
    expect(answerOutcome({ outcome: 'out_of_scope' }, { action: false, ask: false })).toBe(
      'out_of_scope',
    );
    expect(answerOutcome({}, { action: true, ask: true })).toBe('ask');
    expect(answerOutcome({}, { action: true, ask: false })).toBe('action');
    expect(answerOutcome({}, { action: false, ask: false })).toBe('text');
  });
});

describe('capabilities', () => {
  it('parses the production anonymous response and gates on guide.enabled', () => {
    const prod = {
      enabled: true,
      guide: { enabled: true },
      copilot: { enabled: true, surfaces: ['photo'], signedInOnly: true, editSurfaces: ['photo'] },
      turns: { limit: 0, remaining: 0, resetsAt: '2026-11-07T00:00:00Z' },
      frames: true,
      maxFrameBytes: 400000,
      maxMessageChars: 4000,
      spendCapReached: false,
      promptVersion: 'abc',
    };
    const caps = assistantCapabilitiesSchema.parse(prod);
    expect(guideEnabled(caps)).toBe(true);
    expect(guideEnabled(assistantCapabilitiesSchema.parse({ enabled: false }))).toBe(false);
    expect(guideEnabled({ ...(caps as object), guide: { enabled: false } } as typeof caps)).toBe(
      false,
    );
    expect(guideEnabled(undefined)).toBe(false);
    expect(prod.maxMessageChars).toBe(4000);
    expect(assistantApi.endpoints.getAssistantCapabilities).toBeDefined();
  });
});
