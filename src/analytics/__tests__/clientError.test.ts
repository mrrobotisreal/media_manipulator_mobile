import {
  createErrorGate,
  errorProps,
  MAX_ERRORS_PER_SESSION,
  scrubMessage,
  stackHash,
} from '../clientError';
import { EVENTS } from '../events';
import { installErrorHandlers, reportClientError } from '../errorHandlers';
import { makeClient } from '../testing/clientHarness';

jest.mock('../crashlytics', () => ({ crashlyticsRecord: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { crashlyticsRecord } = require('../crashlytics') as { crashlyticsRecord: jest.Mock };

describe('scrubbing', () => {
  it('strips query strings, tokens, emails, ids and digits; truncates to 200', () => {
    const m = scrubMessage(
      'GET https://s3.example/b/k?X-Amz-Signature=abc failed for a.user@example.com job 3f2b6c1e-1d2a-4b3c-8d9e-0a1b2c3d4e5f at 12:30 Bearer abc.def eyJhbGciOiJIUzI1NiJ9.payload.sig',
    );
    expect(m).toBe(
      'GET https://s<n>.example/b/k?<q> failed for <email> job <id> at <n>:<n> Bearer <token> <jwt>',
    );
    expect(scrubMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('stack_hash: 16 hex of message + first 5 frames, stable', () => {
    const e = new Error('boom 42');
    const p = errorProps(e, 'window');
    expect(p).toMatchObject({ message: 'boom <n>', source: 'window', error_type: 'Error' });
    expect(p.stack_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(errorProps(e, 'window').stack_hash).toBe(p.stack_hash);
    expect(stackHash('a', [])).not.toBe(stackHash('b', []));
    expect(JSON.stringify(p)).not.toContain('at ');
  });
});

describe('dedupe + cap', () => {
  it('drops repeats and caps at 10 per session; a new session resets', () => {
    const gate = createErrorGate();
    const p = (i: number) => ({ message: `m`, stack_hash: `h${i}` });
    expect(gate.admit(p(1), 's1')).not.toBeNull();
    expect(gate.admit(p(1), 's1')).toBeNull();
    for (let i = 2; i <= MAX_ERRORS_PER_SESSION; i++) expect(gate.admit(p(i), 's1')).not.toBeNull();
    expect(gate.admit(p(99), 's1')).toBeNull();
    expect(gate.admit(p(1), 's2')).not.toBeNull();
  });

  it('manual client_error (contract_mismatch) is scrubbed and hashed by stage', async () => {
    const { client, sent } = makeClient();
    const ev = {
      message: 'contract_mismatch',
      stage: 'getTiers',
      error_type: 'contract_mismatch',
      source: 'manual' as const,
    };
    client.track(EVENTS.CLIENT_ERROR, ev);
    client.track(EVENTS.CLIENT_ERROR, ev);
    client.track(EVENTS.CLIENT_ERROR, { ...ev, stage: 'getAccountMe' });
    await client.flush();
    expect(sent().map((e) => (e.properties as Record<string, unknown>).stage)).toEqual([
      'getTiers',
      'getAccountMe',
    ]);
    expect((sent()[0]!.properties as Record<string, string>).stack_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('sources', () => {
  beforeEach(() => crashlyticsRecord.mockClear());

  it('window (global handler, chained) / promise (Hermes tracker) / react / manual', () => {
    const track = jest.fn();
    const persistNow = jest.fn();
    const prev = jest.fn();
    let handler: ((e: unknown, fatal?: boolean) => void) | null = null;
    let onUnhandled: ((id: number, r: unknown) => void) | null = null;
    const devUnhandled = jest.fn();
    const uninstall = installErrorHandlers(
      { track, persistNow },
      {
        errorUtils: { getGlobalHandler: () => prev, setGlobalHandler: (fn) => (handler = fn) },
        hermes: { enablePromiseRejectionTracker: (o) => (onUnhandled = o.onUnhandled) },
        devRejectionOptions: { onUnhandled: devUnhandled },
      },
    );

    const fatal = new TypeError('x is undefined');
    handler!(fatal, true);
    expect(track).toHaveBeenLastCalledWith(
      EVENTS.CLIENT_ERROR,
      expect.objectContaining({ source: 'window', stage: 'fatal', error_type: 'TypeError' }),
    );
    expect(persistNow).toHaveBeenCalled();
    expect(prev).toHaveBeenCalledWith(fatal, true); // RNFirebase/RN handler still runs

    onUnhandled!(1, new Error('rejected'));
    expect(track).toHaveBeenLastCalledWith(
      EVENTS.CLIENT_ERROR,
      expect.objectContaining({ source: 'promise' }),
    );
    expect(crashlyticsRecord).toHaveBeenCalledTimes(1);
    expect(devUnhandled).toHaveBeenCalled();

    reportClientError(new Error('render'), 'react', { record: true });
    expect(track).toHaveBeenLastCalledWith(
      EVENTS.CLIENT_ERROR,
      expect.objectContaining({ source: 'react' }),
    );
    expect(crashlyticsRecord).toHaveBeenCalledTimes(2);

    reportClientError('contract', 'manual', { stage: 'getTiers' });
    expect(track).toHaveBeenLastCalledWith(
      EVENTS.CLIENT_ERROR,
      expect.objectContaining({ source: 'manual', stage: 'getTiers' }),
    );
    uninstall();
  });

  it('a throwing tracker never breaks the handler chain', () => {
    const prev = jest.fn();
    let handler: ((e: unknown, fatal?: boolean) => void) | null = null;
    installErrorHandlers(
      {
        track: () => {
          throw new Error('nope');
        },
        persistNow: jest.fn(),
      },
      { errorUtils: { getGlobalHandler: () => prev, setGlobalHandler: (fn) => (handler = fn) } },
    );
    expect(() => handler!(new Error('a'), false)).not.toThrow();
    expect(prev).toHaveBeenCalled();
  });
});
