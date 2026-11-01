import { makeReadyStore } from '@/state/testing';
import { accountApi } from './endpoints/account';
import { tiersApi } from './endpoints/tiers';
import { usageResponseSchema } from './schemas/account';
import { conversionJobSchema } from './schemas/job';
import { tierOf } from './schemas/tier';
import { tiersResponseSchema } from './schemas/tiers';

const limits = {
  opsPerDay: 50,
  aiOpsPerDay: 10,
  exportsPerDay: 20,
  maxFileBytes: 524288000,
  maxVideoSeconds: 3600,
  maxOutputHeight: 2160,
  maxLadderHeight: 1080,
  studioProjects: 20,
  studioVersionAutoKeep: 10,
  priorityGpu: true,
  resultRetentionHours: 72,
  adsRemoved: true,
  rateLimitExempt: false,
  summaryMaxFrames: 24,
  summaryDeep: true,
  vectorExportsPerDay: 50,
  vectorFormats: ['svg', 'png', 'gif'],
  vectorProjects: -1,
  vectorMaxDurationMs: 0,
  vectorVideo: { maxHeight: 1080, maxFps: 30, maxSeconds: 60 },
  voicesSaved: 5,
  voicesMaxSeconds: 30,
  voicesConvert: true,
  voicesConvertMaxSeconds: 60,
};

const proMe = {
  tier: 'pro',
  limits,
  usage: { ops: 3, ai_ops: 1, export: 0 },
  resetsAt: '2026-11-02T00:00:00Z',
  user: {
    id: 'u1',
    firebaseUid: 'fb1',
    email: 'a@b.co',
    emailVerified: true,
    tier: 'pro',
    tierSource: 'stripe',
    displayName: 'A',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    lastSeenAt: '2026-11-01T00:00:00Z',
    subscriptionStatus: 'active',
    billingInterval: 'month',
    cancelAtPeriodEnd: false,
    someFutureField: 1,
  },
  anonymous: false,
  emailVerified: true,
  operatorEligibility: 'none',
  aFutureTopLevelKey: { x: 1 },
};

const freeMe = {
  ...proMe,
  tier: 'free',
  operatorEligibility: 'unverified',
  user: { ...proMe.user, tier: 'free', tierSource: 'default', subscriptionStatus: undefined },
};

const prices = { premiumMonthly: 8, premiumYearly: 80, proMonthly: 20, proYearly: 200 };
const tiersBody = {
  tiers: ['anonymous', 'free', 'premium', 'pro'].map((tier) => ({ tier, limits })),
  premiumPurchasable: true,
  proPurchasable: false,
  defaultCurrency: 'usd',
  prices: { usd: prices, eur: prices },
  premiumPriceUSD: 8,
};

const job = {
  id: 'j1',
  status: 'pending',
  originalFile: { name: 'a.mp4', size: 10, type: 'video/mp4' },
  options: { crf: 28 },
  createdAt: '2026-11-01T00:00:00Z',
};

describe('schemas', () => {
  it('parses /account/me for a signed-in Pro user and accepts unknown keys', () => {
    const r = usageResponseSchema.parse(proMe);
    expect(r.user?.subscriptionStatus).toBe('active');
    expect((r as Record<string, unknown>).aFutureTopLevelKey).toBeUndefined(); // stripped, not rejected
  });

  it('parses /account/me for free with operatorEligibility', () => {
    expect(usageResponseSchema.parse(freeMe).operatorEligibility).toBe('unverified');
  });

  it('parses an anonymous /account/usage without a user', () => {
    const { user: _u, operatorEligibility: _o, ...anon } = freeMe;
    void _u;
    void _o;
    expect(usageResponseSchema.parse({ ...anon, anonymous: true }).user).toBeUndefined();
  });

  it('parses /tiers with prices.usd/eur', () => {
    const r = tiersResponseSchema.parse(tiersBody);
    expect(r.prices.eur.proYearly).toBe(200);
    expect(r.tiers).toHaveLength(4);
  });

  it('parses jobs: pending, completed, failed', () => {
    expect(conversionJobSchema.parse(job).status).toBe('pending');
    const done = conversionJobSchema.parse({
      ...job,
      status: 'completed',
      progress: 100,
      resultUrl: 'https://x/y',
      completedAt: '2026-11-01T00:01:00Z',
      resultMime: 'video/mp4',
      resultSizeBytes: 5,
      metadataAvailable: { original: true, result: true },
      novel: true,
    });
    expect(done.resultMime).toBe('video/mp4');
    expect(conversionJobSchema.parse({ ...job, status: 'failed', error: 'boom' }).error).toBe(
      'boom',
    );
    expect(conversionJobSchema.safeParse({ ...job, status: 'weird' }).success).toBe(false);
  });

  it('tierOf normalises with a free fallback', () => {
    expect(tierOf('pro')).toBe('pro');
    expect(tierOf('platinum')).toBe('free');
    expect(usageResponseSchema.parse({ ...proMe, tier: 'platinum' }).tier).toBe('platinum');
  });
});

describe('account and tiers endpoints (fake fetch)', () => {
  const realFetch = global.fetch;
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status,
        headers: new Headers(headers),
        text: () => Promise.resolve(JSON.stringify(body)),
      }),
    ) as never;
  };
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('getAccountMe returns parsed data and feeds the quota slice', async () => {
    const { store } = await makeReadyStore();
    reply(proMe, 200, {
      'X-MM-Tier': 'pro',
      'X-MM-Quota-Limit': '50',
      'X-MM-Quota-Remaining': '47',
      'X-MM-Quota-Reset': '2026-11-02T00:00:00Z',
    });
    const res = await store.dispatch(accountApi.endpoints.getAccountMe.initiate());
    expect(res.data?.tier).toBe('pro');
    expect(store.getState().quota.tier).toBe('pro');
    expect(store.getState().quota.metrics.ops).toEqual({
      limit: 50,
      remaining: 47,
      resetAt: '2026-11-02T00:00:00Z',
    });
  });

  it('getTiers with a missing tier -> contract_mismatch and one client_error', async () => {
    const { store } = await makeReadyStore();
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const bad = { ...tiersBody, tiers: [{ limits }] };
    reply(bad);
    const res = await store.dispatch(tiersApi.endpoints.getTiers.initiate());
    expect(res.error).toMatchObject({ code: 'contract_mismatch', status: 'PARSE_ERROR' });
    const events = debug.mock.calls.filter((c) => c[1] === 'client_error');
    expect(events).toHaveLength(1);
    expect(events[0]![2]).toMatchObject({ message: 'contract_mismatch', stage: 'getTiers' });
  });

  it('syncAccount POSTs the body', async () => {
    const { store } = await makeReadyStore();
    reply(proMe);
    const res = await store.dispatch(
      accountApi.endpoints.syncAccount.initiate({ signupSource: 'mobile', locale: 'en-US' }),
    );
    expect(res).toMatchObject({ data: { tier: 'pro' } });
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ signupSource: 'mobile', locale: 'en-US' });
  });
});
