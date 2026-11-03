import { render, screen, within } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { tiersApi } from '@/api/endpoints/tiers';
import type { AccountUser } from '@/api/schemas/account';
import { i18n } from '@/i18n';
import { TIERS } from '@/quota/testFixtures';
import { makeReadyStore } from '@/state/testing';
import { PlanCard, planKind } from '../PlanCard';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
const mockOpenURL = jest.fn();
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const user = (over: Partial<AccountUser>): AccountUser => ({
  id: 'u',
  firebaseUid: 'f',
  emailVerified: true,
  tier: 'pro',
  tierSource: 'subscription',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  ...over,
});

async function show(tier: string, u?: AccountUser) {
  const { store } = await makeReadyStore();
  await store.dispatch(
    tiersApi.util.upsertQueryData('getTiers', undefined, {
      tiers: TIERS,
      premiumPurchasable: true,
      proPurchasable: true,
      defaultCurrency: 'usd',
      prices: {
        usd: { premiumMonthly: 8, premiumYearly: 80, proMonthly: 20, proYearly: 200 },
        eur: { premiumMonthly: 8, premiumYearly: 80, proMonthly: 20, proYearly: 200 },
      },
    }),
  );
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <PlanCard tier={tier} user={u} />
      </I18nextProvider>
    </Provider>,
  );
  return screen.getByTestId('plan-card');
}

/** Nothing on the card may be tappable (MA-0008). */
function expectNoPressables(card: ReturnType<typeof screen.getByTestId>) {
  expect(within(card).queryAllByRole('button')).toHaveLength(0);
  expect(within(card).queryAllByRole('link')).toHaveLength(0);
  // No host element in the rendered tree responds to touches (Pressable, Text onPress, Button).
  const touchy: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const k of Object.keys(node.props ?? {}))
      if (/^(onClick|onPress|onResponderGrant|onResponderRelease)$/.test(k)) touchy.push(k);
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  expect(touchy).toEqual([]);
}

describe('PlanCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PlanCard shows "managed on the web" with no link for subscription users', async () => {
    const card = await show(
      'pro',
      user({ tierSource: 'subscription', subscriptionStatus: 'active' }),
    );
    expect(within(card).getByText('Pro · Your plan is managed on the web.')).toBeTruthy();
    expectNoPressables(card);
    const WebBrowser = jest.requireMock('expo-web-browser') as { openBrowserAsync: jest.Mock };
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('subscription: ends-on date and past-due note are neutral plain text', async () => {
    const card = await show(
      'premium',
      user({
        tier: 'premium',
        cancelAtPeriodEnd: true,
        tierExpiresAt: '2026-12-01T00:00:00Z',
        subscriptionStatus: 'past_due',
      }),
    );
    expect(within(card).getByText(/^Ends on /)).toBeTruthy();
    expect(within(card).getByText('There is a problem with the latest payment.')).toBeTruthy();
    expectNoPressables(card);
  });

  it('manual grant shows Granted and the expiry', async () => {
    const card = await show(
      'pro',
      user({ tierSource: 'manual_grant', tierExpiresAt: '2027-01-01T00:00:00Z' }),
    );
    expect(within(card).getByText('Pro · Granted')).toBeTruthy();
    expect(within(card).getByText(/^Until /)).toBeTruthy();
    expectNoPressables(card);
  });

  it('PlanCard free tier renders comparison without buttons', async () => {
    const card = await show('free', user({ tier: 'free', tierSource: 'default' }));
    expect(
      within(card).getByText('Higher daily limits are available on Premium and Pro.'),
    ).toBeTruthy();
    const table = within(card).getByTestId('plan-table');
    for (const n of ['Free', 'Premium', 'Pro']) expect(within(table).getByText(n)).toBeTruthy();
    expectNoPressables(card);
  });

  it('operator', async () => {
    const card = await show('operator', user({ tier: 'operator', tierSource: 'operator' }));
    expect(within(card).getByText('Operator')).toBeTruthy();
  });

  it('planKind maps tierSource', () => {
    expect(planKind('pro', { tierSource: 'subscription' })).toBe('subscription');
    expect(planKind('pro', { tierSource: 'manual_grant' })).toBe('grant');
    expect(planKind('free', { tierSource: 'default' })).toBe('free');
    expect(planKind('operator', undefined)).toBe('operator');
    expect(planKind('premium', undefined)).toBe('subscription');
  });
});
