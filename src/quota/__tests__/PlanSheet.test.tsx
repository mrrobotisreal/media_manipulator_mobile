import { render, screen, within } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { accountApi } from '@/api/endpoints/account';
import { tiersApi } from '@/api/endpoints/tiers';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { PlanSheet } from '../PlanSheet';
import { SNAPSHOT, TIERS } from '../testFixtures';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function show(tier = 'free') {
  const { store } = await makeReadyStore();
  await store.dispatch(
    accountApi.util.upsertQueryData('getAccountMe', undefined, {
      tier,
      emailVerified: true,
      anonymous: false,
      limits: SNAPSHOT.limits,
      usage: { ops: 24, ai_ops: 1 },
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
        usd: { premiumMonthly: 8, premiumYearly: 80, proMonthly: 20, proYearly: 200 },
        eur: { premiumMonthly: 8, premiumYearly: 80, proMonthly: 20, proYearly: 200 },
      },
    }),
  );
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <PlanSheet visible onClose={jest.fn()} />
      </I18nextProvider>
    </Provider>,
  );
}

describe('PlanSheet (free tier)', () => {
  it('shows Free, Premium, Pro columns only and marks the current tier', async () => {
    await show('free');
    const table = screen.getByTestId('plan-table');
    for (const name of ['Free', 'Premium', 'Pro'])
      expect(within(table).getByText(name)).toBeTruthy();
    expect(within(table).queryByText(/anonymous/i)).toBeNull();
    expect(screen.getByTestId('plan-col-current')).toBeTruthy();
    expect(within(screen.getByTestId('plan-col-current')).getByText('Free')).toBeTruthy();
    expect(screen.getByTestId('plan-current-tier').props.children).toBe('Free');
  });

  it('formats the values per row', async () => {
    await show('free');
    const table = screen.getByTestId('plan-table');
    for (const v of [
      '30',
      '300',
      '700',
      '10',
      '100',
      '200',
      '1 GB',
      '20 min',
      '2 hr',
      '1080p',
      '2160p',
      '7 days',
    ])
      expect(within(table).getAllByText(v).length).toBeGreaterThan(0);
    expect(within(table).getAllByText('5 GB')).toHaveLength(2);
    expect(within(table).getAllByText(/^1080p$/)).toHaveLength(1);
    expect(within(table).getAllByText(/^2160p$/)).toHaveLength(1);
    expect(within(table).getAllByText(/^1440p$/)).toHaveLength(1);
  });

  it('has no prices, buttons other than OK, or sales words', async () => {
    await show('free');
    expect(screen.queryByText(/\$|€|upgrade|buy|subscribe/i)).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(1);
    expect(screen.getByText('Plans are managed on your Media Manipulator account.')).toBeTruthy();
    expect(screen.getByText('Resets in', { exact: false })).toBeTruthy();
  });

  it('marks Pro when on Pro', async () => {
    await show('pro');
    expect(within(screen.getByTestId('plan-col-current')).getByText('Pro')).toBeTruthy();
  });
});
