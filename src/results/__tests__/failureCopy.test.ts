import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_STATES, type JobRecord } from '@/jobs/types';
import { ALL_ERROR_CODES, FAILURE_KEYS, failureKeyFor, failureKeyForCode } from '../failureCopy';

const en = JSON.parse(readFileSync(join(__dirname, '../../../locales/en-us/app.json'), 'utf8'));

describe('failure copy map', () => {
  it('every key it can return exists in en-US result.failed', () => {
    for (const k of FAILURE_KEYS) expect(typeof en.result.failed[k]).toBe('string');
  });

  it('every MmError code (client + API) and an unknown api: code resolve to a real key', () => {
    for (const code of [...ALL_ERROR_CODES, 'api:brand_new_code']) {
      expect(FAILURE_KEYS).toContain(failureKeyForCode(code));
    }
    expect(failureKeyForCode(undefined)).toBe('generic');
  });

  it('maps the notable codes', () => {
    expect(failureKeyForCode('network')).toBe('network');
    expect(failureKeyForCode('quota_exceeded')).toBe('quota');
    expect(failureKeyForCode('file_too_large')).toBe('tooLarge');
    expect(failureKeyForCode('interrupted')).toBe('interrupted');
    expect(failureKeyForCode('file_gone')).toBe('fileGone');
  });

  it('every MA12 job state maps to a real key', () => {
    for (const state of JOB_STATES) {
      const key = failureKeyFor({ state, error: undefined } as Pick<JobRecord, 'state' | 'error'>);
      expect(FAILURE_KEYS).toContain(key);
    }
    expect(failureKeyFor({ state: 'failed', error: undefined })).toBe('processing');
    expect(failureKeyFor({ state: 'lost', error: undefined })).toBe('lost');
    expect(
      failureKeyFor({
        state: 'rejected',
        error: { status: 413, code: 'payload_too_large', details: {} },
      }),
    ).toBe('tooLarge');
    expect(failureKeyFor({ state: 'rejected', error: undefined })).toBe('rejected');
  });
});
