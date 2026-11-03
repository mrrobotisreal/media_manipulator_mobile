import { createMMKV } from 'react-native-mmkv';
import {
  createOutbox,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_BYTES,
  OUTBOX_MAX_EVENTS,
  type WireEvent,
} from '../outbox';

let n = 0;
const ev = (over: Partial<WireEvent> = {}): WireEvent => ({
  insert_id: `id-${++n}`,
  event_name: 'screen_viewed',
  event_ts: new Date().toISOString(),
  visitor_id: 'v',
  session_id: 's',
  context: {},
  properties: { screen: '/tools' },
  priority: 2,
  ...over,
});

describe('outbox', () => {
  let id = 0;
  const storage = () => createMMKV({ id: `outbox-test-${++id}` });

  it('caps at 1000 events, dropping the oldest', () => {
    const o = createOutbox(storage());
    const first = ev();
    o.push(first);
    for (let i = 0; i < OUTBOX_MAX_EVENTS; i++) o.push(ev());
    expect(o.size()).toBe(OUTBOX_MAX_EVENTS);
    expect(o.all().some((e) => e.insert_id === first.insert_id)).toBe(false);
  });

  it('caps at 1 MB, dropping the oldest', () => {
    const o = createOutbox(storage());
    const big = 'x'.repeat(100_000);
    for (let i = 0; i < 12; i++) o.push(ev({ properties: { screen: big } }));
    expect(o.bytes()).toBeLessThanOrEqual(OUTBOX_MAX_BYTES);
    expect(o.size()).toBe(9);
  });

  it('drops events older than 7 days at prune', () => {
    const o = createOutbox(storage());
    const now = Date.parse('2026-11-03T12:00:00Z');
    o.push(ev({ event_ts: new Date(now - OUTBOX_MAX_AGE_MS - 1).toISOString() }));
    o.push(ev({ event_ts: new Date(now - 1000).toISOString() }));
    expect(o.prune(now)).toBe(1);
    expect(o.size()).toBe(1);
  });

  it('persists across a rebuild (debounced write, persistNow)', () => {
    jest.useFakeTimers();
    const s = storage();
    const a = createOutbox(s);
    a.push(ev());
    a.push(ev());
    expect(createOutbox(s).size()).toBe(0); // not written yet: one debounced write for the burst
    jest.advanceTimersByTime(250);
    expect(createOutbox(s).size()).toBe(2);
    a.push(ev());
    a.persistNow();
    expect(createOutbox(s).size()).toBe(3);
    a.clear();
    expect(createOutbox(s).size()).toBe(0);
    jest.useRealTimers();
  });

  it('removes by insert id', () => {
    const o = createOutbox(storage());
    const a = ev();
    const b = ev();
    o.push(a);
    o.push(b);
    o.remove(new Set([a.insert_id]));
    expect(o.all().map((e) => e.insert_id)).toEqual([b.insert_id]);
  });
});
