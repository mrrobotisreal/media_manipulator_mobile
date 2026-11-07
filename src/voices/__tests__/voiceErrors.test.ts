import { normaliseError } from '@/api/errors';
import { VOICE_ERROR_CODES, voiceErrorCode, voiceErrorKey, voiceErrorValues } from '../errors';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const panels = require('@/i18n/generated/en-us/interface/panels.json') as {
  voiceTools: { errors: Record<string, string> };
};

describe('voice errors (MA34 decision 2)', () => {
  it('every VOICE_ERROR_CODES entry has synced web copy', () => {
    for (const code of VOICE_ERROR_CODES) {
      expect(typeof panels.voiceTools.errors[code]).toBe('string');
      expect(voiceErrorKey(code)).toBe(`interface:voiceTools.errors.${code}`);
    }
    // ...and the web has no code the app lacks.
    expect(Object.keys(panels.voiceTools.errors).sort()).toEqual([...VOICE_ERROR_CODES].sort());
  });

  it('every code the server writes maps through normaliseError to itself', () => {
    for (const code of VOICE_ERROR_CODES.filter((c) => c !== 'rate_limited' && c !== 'generic')) {
      const status = code === 'sign_in_required' ? 401 : code === 'voices_unavailable' ? 503 : 400;
      expect(voiceErrorCode(normaliseError(status, { error: code, message: 'x' }))).toBe(code);
    }
  });

  it('a 429 without a code is rate_limited (the route limiter speaks prose)', () => {
    const e = normaliseError(429, {
      error: 'Too many requests, slow down',
      retryAfterSeconds: 30,
      scope: 'voices_create',
    });
    expect(voiceErrorCode(e)).toBe('rate_limited');
    expect(voiceErrorCode(normaliseError(429, undefined))).toBe('rate_limited');
  });

  it('the sign-in alias, 401 and 503 fallbacks, and unknown codes', () => {
    expect(voiceErrorCode({ status: 401, code: 'signin_required' })).toBe('sign_in_required');
    expect(voiceErrorCode(normaliseError(401, undefined))).toBe('sign_in_required');
    expect(voiceErrorCode(normaliseError(503, { message: 'down' }))).toBe('voices_unavailable');
    expect(voiceErrorCode(normaliseError(500, { error: 'brand_new_code' }))).toBe('generic');
    expect(voiceErrorCode(normaliseError(418, undefined))).toBe('generic');
  });

  it('interpolation values come from the body (limit, seconds...)', () => {
    const e = normaliseError(413, { error: 'voice_input_too_long', limit: 60, seconds: 91.2 });
    expect(voiceErrorValues(e)).toEqual({ limit: 60, seconds: 91.2 });
    const l = normaliseError(403, {
      error: 'voice_limit',
      limit: 1,
      used: 1,
      tier: 'free',
      upgradePath: '/pricing',
    });
    expect(voiceErrorValues(l)).toEqual({ limit: 1, used: 1 });
  });
});
