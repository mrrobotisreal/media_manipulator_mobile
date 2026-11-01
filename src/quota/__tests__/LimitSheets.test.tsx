import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Linking } from 'react-native';
import { Provider } from 'react-redux';
import { accountApi } from '@/api/endpoints/account';
import { tiersApi } from '@/api/endpoints/tiers';
import { normaliseError, type MmError } from '@/api/errors';
import { track } from '@/analytics/track';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { LimitSheet } from '../LimitSheets';
import { SNAPSHOT, TIERS } from '../testFixtures';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function show(error: MmError, tier = 'free', onClose = jest.fn()) {
  const { store } = await makeReadyStore();
  await store.dispatch(
    accountApi.util.upsertQueryData('getAccountMe', undefined, {
      tier,
      emailVerified: true,
      anonymous: false,
      limits: SNAPSHOT.limits,
      usage: { ops: 30 },
      resetsAt: '2099-01-01T00:00:00Z',
    }),
  );
  await store.dispatch(
    tiersApi.util.upsertQueryData('getTiers', undefined, {
      tiers: TIERS,
      premiumPurchasable: true,
      proPurchasable: true,
      defaultCurrency: 'usd',
      prices: {
        usd: { premiumMonthly: 1, premiumYearly: 1, proMonthly: 1, proYearly: 1 },
        eur: { premiumMonthly: 1, premiumYearly: 1, proMonthly: 1, proYearly: 1 },
      },
    }),
  );
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <LimitSheet visible error={error} onClose={onClose} toolSlug="video-compress" />
      </I18nextProvider>
    </Provider>,
  );
  return onClose;
}

const events = () => (track as jest.Mock).mock.calls.filter(([n]) => n === 'quota_exceeded_shown');

beforeEach(() => (track as jest.Mock).mockClear());

describe('LimitSheet variants', () => {
  it('429 quota_exceeded from the real body: title, reset, comparison, See all limits', async () => {
    const e = normaliseError(429, {
      error: 'quota_exceeded',
      tier: 'free',
      metric: 'ops',
      limit: 30,
      used: 31,
      resetsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      upgradePath: 'premium',
    });
    await show(e);
    expect(screen.getByText("You've used all 30 operations for today.")).toBeTruthy();
    expect(screen.getByText(/^Resets in/)).toBeTruthy();
    expect(screen.getByText('Premium: 300 a day')).toBeTruthy();
    expect(screen.getByText('Pro: 700 a day')).toBeTruthy();
    expect(screen.getByText('See all limits')).toBeTruthy();
    expect(events()).toEqual([
      ['quota_exceeded_shown', { limit: 30, scope: 'ops', tool_slug: 'video-compress' }],
    ]);
  });

  it('429 on the AI metric names AI operations and scopes ai_ops', async () => {
    await show(
      normaliseError(429, { error: 'quota_exceeded', metric: 'ai_ops', limit: 10, used: 11 }),
    );
    expect(screen.getByText("You've used all 10 AI operations for today.")).toBeTruthy();
    expect(events()[0]![1]).toMatchObject({ scope: 'ai_ops', limit: 10 });
  });

  it('429 rate limit counts down and sends no analytics event', async () => {
    jest.useFakeTimers();
    await show(
      normaliseError(429, {
        error: 'Too many requests, please try again later',
        retryAfterSeconds: 3,
        scope: 'ip',
      }),
    );
    expect(screen.getByText('Try again in 3 s.')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Try again in 2 s.')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText('You can try again now.')).toBeTruthy();
    expect(events()).toHaveLength(0);
    jest.useRealTimers();
  });

  it('403 output_height_limited: requested/limit and the Premium fact', async () => {
    await show(
      normaliseError(403, {
        error: 'output_height_limited',
        message: 'x',
        limit: 1080,
        requested: 2160,
        upgradePath: 'premium',
      }),
    );
    expect(screen.getByText('This output is taller than your plan allows')).toBeTruthy();
    expect(screen.getByText('You asked for 2160p; your plan allows up to 1080p.')).toBeTruthy();
    expect(screen.getByTestId('limit-fact').props.children).toMatch(/1440p/);
    expect(events()[0]![1]).toEqual({
      limit: 1080,
      scope: 'output_height_limited',
      tool_slug: 'video-compress',
    });
  });

  it('403 on Pro: nothing higher, tells the user to lower the setting', async () => {
    await show(
      normaliseError(403, { error: 'output_height_limited', limit: 2160, requested: 4320 }),
      'pro',
    );
    expect(screen.queryByTestId('limit-fact')).toBeNull();
    expect(screen.getByText(/Lower the setting to continue\./)).toBeTruthy();
  });

  it('413 without a reason (file_too_large): limit from the account and a higher-tier fact', async () => {
    await show(normaliseError(413, { error: 'Video exceeds maximum upload size' }));
    expect(screen.getByText('This file is larger than your plan allows')).toBeTruthy();
    expect(screen.getByText('Your plan accepts files up to 1 GB.')).toBeTruthy();
    expect(screen.getByText('Premium and Pro accept files up to 5 GB.')).toBeTruthy();
    expect(events()[0]![1]).toMatchObject({ scope: 'file_too_large', limit: 1_073_741_824 });
  });

  it('413 video_duration: too long with the plan limit and the higher-tier fact', async () => {
    await show(
      normaliseError(413, { error: 'Video is too long', reason: 'video_duration', limit: 1200 }),
    );
    expect(screen.getByText('This is longer than your plan allows')).toBeTruthy();
    expect(screen.getByText('Your plan allows up to 20 min.')).toBeTruthy();
    expect(screen.getByText('Premium and Pro allow videos up to 2 hr.')).toBeTruthy();
    expect(events()[0]![1]).toMatchObject({ scope: 'video_duration', limit: 1200 });
  });

  it.each(['video_width', 'video_height', 'video_pixels', 'video_fps'])(
    '413 %s is a deployment cap: no higher-tier row',
    async (reason) => {
      await show(normaliseError(413, { error: 'Video too big', reason }));
      expect(screen.getByText('This file is above what the service accepts')).toBeTruthy();
      expect(screen.queryByTestId('limit-fact')).toBeNull();
      expect(events()[0]![1]).toMatchObject({ scope: reason });
    },
  );

  it('OK closes; nothing opens a link', async () => {
    const open = jest.spyOn(Linking, 'openURL');
    const close = await show(
      normaliseError(429, { error: 'quota_exceeded', metric: 'ops', limit: 30 }),
    );
    await fireEvent.press(screen.getByText('OK'));
    expect(close).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('an error with no sheet renders nothing', async () => {
    await show({ status: 500, code: 'server_error', details: {} });
    expect(screen.queryByTestId('limit-sheet-quota')).toBeNull();
    expect(events()).toHaveLength(0);
  });
});

describe('no sales copy in any locale', () => {
  const root = join(__dirname, '../../../locales');
  const BAD =
    /upgrade|buy|subscribe|purchase|checkout|billing|pricing|https?:\/\/|www\.|\$|€|£|¥|upgrad|comprar|acheter|kaufen|abonn|suscri|assin|купи|оформ|підпис|購入|구매|购买|購買|mua |đăng ký|खरीद|اشتر|רכוש|acquist|abbon/i;
  const collect = (o: unknown, out: string[] = []): string[] => {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object') Object.values(o).forEach((v) => collect(v, out));
    return out;
  };
  const codes = readdirSync(root).filter((d) => d !== 'REVIEW.md');
  it.each(codes)('%s quota.* has no purchase wording, price or link', (code) => {
    const app = JSON.parse(readFileSync(join(root, code, 'app.json'), 'utf8'));
    for (const s of collect(app.quota)) expect(s).not.toMatch(BAD);
  });
});
