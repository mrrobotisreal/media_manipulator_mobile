import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import AccountOverview from '../../../app/(app)/(tabs)/account/index';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { accountApi } from '@/api/endpoints/account';
import { tiersApi } from '@/api/endpoints/tiers';
import { i18n } from '@/i18n';
import { SNAPSHOT, TIERS } from '@/quota/testFixtures';
import { makeReadyStore } from '@/state/testing';

jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => ({ track: jest.fn(), reset: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});
const mockBrowser = jest.fn();
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (...a: unknown[]) => mockBrowser(...a) }));

async function show(over: Record<string, unknown>, tier: string) {
  const { store } = await makeReadyStore();
  await store.dispatch(
    accountApi.util.upsertQueryData('getAccountMe', undefined, {
      tier,
      emailVerified: true,
      anonymous: false,
      limits: SNAPSHOT.limits,
      usage: { ops: 4, ai_ops: 0 },
      resetsAt: '2099-01-01T00:00:00Z',
      user: {
        id: 'u',
        firebaseUid: 'f',
        emailVerified: true,
        tier,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        tierSource: 'default',
        ...over,
      },
    } as never),
  );
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
        <AccountOverview />
      </I18nextProvider>
    </Provider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('Account overview', () => {
  it('lists the sections and routes to the sub-screens', async () => {
    await show({}, 'free');
    for (const label of [
      'Storage & retention',
      'Notifications',
      'Language',
      'Privacy & data',
      'Sign out',
      'Sign out everywhere',
      'Privacy Policy',
      'Terms of Service',
      'About',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByText('Storage & retention'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/(tabs)/account/retention');
  });

  it('legal links open the localized web page in the in-app browser', async () => {
    await show({}, 'free');
    await fireEvent.press(screen.getByText('Privacy Policy'));
    expect(mockBrowser).toHaveBeenCalledWith('https://www.media-manipulator.com/privacy-policy');
    await fireEvent.press(screen.getByText('Terms of Service'));
    expect(mockBrowser).toHaveBeenLastCalledWith(
      'https://www.media-manipulator.com/terms-of-service',
    );
  });

  it('emits subscription_status_viewed for subscription users only', async () => {
    await show(
      { tierSource: 'subscription', subscriptionStatus: 'active', billingInterval: 'month' },
      'premium',
    );
    expect(track).toHaveBeenCalledWith(EVENTS.SUBSCRIPTION_STATUS_VIEWED, {
      status: 'active',
      interval: 'month',
    });
  });

  it('does not emit it for free or granted users', async () => {
    await show({}, 'free');
    expect(track).not.toHaveBeenCalledWith(EVENTS.SUBSCRIPTION_STATUS_VIEWED, expect.anything());
  });

  it('no row on the tab mentions checkout, billing portal or pricing', async () => {
    await show({ tierSource: 'subscription', subscriptionStatus: 'past_due' }, 'pro');
    expect(screen.queryByText(/checkout|portal|pricing|upgrade|subscribe/i)).toBeNull();
  });
});
