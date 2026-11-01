import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { QuotaMeter, quotaTone } from '../components/QuotaMeter';

const view = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('QuotaMeter', () => {
  it('tone thresholds at 59 / 60 / 99 / 100 %', () => {
    expect(quotaTone(59, 100)).toBe('data');
    expect(quotaTone(60, 100)).toBe('premium');
    expect(quotaTone(99, 100)).toBe('premium');
    expect(quotaTone(100, 100)).toBe('primary');
    expect(quotaTone(0, 0)).toBe('muted');
  });

  it('renders the tone, mono readout and accessibility label', async () => {
    await view(<QuotaMeter used={60} limit={100} />);
    expect(screen.getByTestId('quota-meter-premium')).toBeTruthy();
    expect(screen.getByText('60 / 100')).toBeTruthy();
    expect(screen.getByLabelText('60 / 100 daily operations used')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('labels the AI meter', async () => {
    await view(<QuotaMeter metric="ai_ops" used={1} limit={10} />);
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('1 / 10')).toBeTruthy();
  });

  it('unlimited shows the infinity sign and no fill tone', async () => {
    await view(<QuotaMeter used={0} limit={-1} />);
    expect(screen.getByText('∞')).toBeTruthy();
    expect(screen.getByTestId('quota-meter-muted')).toBeTruthy();
  });

  it('pending shows a dash skeleton', async () => {
    await view(<QuotaMeter used={0} limit={0} pending />);
    expect(screen.getByTestId('quota-meter-pending')).toBeTruthy();
    expect(screen.getByText('— / —')).toBeTruthy();
  });
});
