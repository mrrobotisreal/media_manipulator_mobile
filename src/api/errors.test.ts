import {
  API_ERROR_CODES,
  contractMismatch,
  networkError,
  normaliseError,
  timeoutError,
} from './errors';

describe('normaliseError', () => {
  it('network failure and timeout', () => {
    expect(networkError('boom')).toMatchObject({ status: 'FETCH_ERROR', code: 'network' });
    expect(timeoutError(30000)).toMatchObject({ code: 'timeout', details: { timeoutMs: 30000 } });
  });

  it('429 limiter body -> rate_limited with retryAfterSeconds and scope', () => {
    const e = normaliseError(429, {
      error: 'Too many requests. Please slow down and try again shortly.',
      retryAfterSeconds: 7,
      scope: 'ip',
    });
    expect(e.code).toBe('rate_limited');
    expect(e.details).toEqual({ retryAfterSeconds: 7, scope: 'ip' });
    expect(e.message).toMatch(/Too many requests/);
  });

  it('429 limiter body falls back to Retry-After header', () => {
    const e = normaliseError(
      429,
      { error: 'x', retryAfterSeconds: 'soon', scope: 'user' },
      { 'retry-after': '12' },
    );
    expect(e.details).toEqual({ retryAfterSeconds: 12, scope: 'user' });
  });

  it('429 quota_exceeded keeps its code and details', () => {
    const e = normaliseError(429, {
      error: 'quota_exceeded',
      tier: 'free',
      metric: 'ops',
      limit: 10,
      used: 11,
      resetsAt: '2026-11-02T00:00:00Z',
      upgradePath: 'premium',
    });
    expect(e.code).toBe('quota_exceeded');
    expect(e.details).toMatchObject({ metric: 'ops', limit: 10, upgradePath: 'premium' });
  });

  it('403 output_height_limited', () => {
    const e = normaliseError(403, {
      error: 'output_height_limited',
      message: 'Too tall',
      limit: 720,
      requested: 1080,
      upgradePath: 'premium',
    });
    expect(e.code).toBe('output_height_limited');
    expect(e.details).toMatchObject({ limit: 720, requested: 1080 });
  });

  it('413 with a reason -> source_limit_exceeded', () => {
    const e = normaliseError(413, {
      error: 'Video exceeds maximum duration',
      reason: 'video_duration',
    });
    expect(e.code).toBe('source_limit_exceeded');
    expect(e.details.reason).toBe('video_duration');
  });

  it('413 human string without reason -> payload_too_large', () => {
    expect(normaliseError(413, { error: 'Video exceeds maximum upload size' }).code).toBe(
      'payload_too_large',
    );
  });

  it('413 payload_too_large code stays', () => {
    expect(normaliseError(413, { error: 'payload_too_large' }).code).toBe('payload_too_large');
  });

  it('401 human strings -> unauthenticated', () => {
    expect(normaliseError(401, { error: 'Authentication required' }).code).toBe('unauthenticated');
    expect(normaliseError(401, { error: 'Invalid or expired credentials' }).code).toBe(
      'unauthenticated',
    );
  });

  it('401 reauth_required keeps its code', () => {
    expect(normaliseError(401, { error: 'reauth_required' }).code).toBe('reauth_required');
  });

  it('404 Job not found -> not_found', () => {
    const e = normaliseError(404, { error: 'Job not found' });
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('Job not found');
  });

  it('sign_in_required alias', () => {
    expect(normaliseError(401, { error: 'sign_in_required' }).code).toBe('signin_required');
    expect(normaliseError(401, { error: 'signin_required' }).code).toBe('signin_required');
  });

  it('unknown snake_case passes through as api:', () => {
    expect(normaliseError(400, { error: 'brand_new_code' }).code).toBe('api:brand_new_code');
  });

  it('voice refusals keep reason in details', () => {
    const e = normaliseError(400, { error: 'invalid_request', reason: 'consent_required' });
    expect(e.details.reason).toBe('consent_required');
  });

  it.each([
    [400, 'bad_request'],
    [403, 'forbidden'],
    [409, 'conflict'],
    [500, 'server_error'],
    [503, 'server_error'],
    [418, 'unknown'],
  ])('status %i with human body -> %s', (status, code) => {
    expect(normaliseError(status, { error: 'Something human' }).code).toBe(code);
  });

  it('non-JSON body is tolerated', () => {
    expect(normaliseError(502, '<html>').code).toBe('server_error');
    expect(normaliseError(404, null).code).toBe('not_found');
  });

  it('contract_mismatch carries paths only', () => {
    expect(contractMismatch('getTiers', ['tier'])).toEqual({
      status: 'PARSE_ERROR',
      code: 'contract_mismatch',
      details: { endpoint: 'getTiers', issues: ['tier'] },
    });
  });

  it('every API code from the API grep is a known code', () => {
    for (const code of API_ERROR_CODES) {
      expect(normaliseError(400, { error: code }).code).toBe(code);
    }
  });
});
