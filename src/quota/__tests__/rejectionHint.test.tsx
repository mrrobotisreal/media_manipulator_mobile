import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { tiersApi } from '@/api/endpoints/tiers';
import { RejectionCard } from '@/files/components/FileCard';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { TIERS } from '../testFixtures';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function show(reason: 'too_large' | 'too_long' | 'empty') {
  const { store } = await makeReadyStore();
  store.dispatch({ type: 'quota/observed', payload: { tier: 'free' } });
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
        <RejectionCard
          rejection={{
            id: 'a',
            name: 'big.mp4',
            extension: 'mp4',
            mediaKind: 'video',
            sizeBytes: 2e9,
            durationSec: 4000,
            reason,
            limit: 1200,
          }}
        />
      </I18nextProvider>
    </Provider>,
  );
}

describe('MA11 rejection hint rows', () => {
  it('too_long adds the neutral higher-tier fact', async () => {
    await show('too_long');
    expect(screen.getByText('Premium and Pro allow videos up to 2 hr.')).toBeTruthy();
    expect(screen.getByTestId('rejection-fact')).toBeTruthy();
  });
  it('too_large adds the file-size fact', async () => {
    await show('too_large');
    expect(screen.getByText('Premium and Pro accept files up to 5 GB.')).toBeTruthy();
  });
  it('other reasons get none', async () => {
    await show('empty');
    expect(screen.queryByTestId('rejection-fact')).toBeNull();
  });
});
