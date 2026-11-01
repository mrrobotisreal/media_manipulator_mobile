import { render, screen } from '@testing-library/react-native';
import { QuotaMeter, quotaTone } from '../components/QuotaMeter';

describe('QuotaMeter', () => {
  it('tone thresholds: data < 60%, premium >= 60%, primary at 100%', async () => {
    expect(quotaTone(59, 100)).toBe('data');
    expect(quotaTone(60, 100)).toBe('premium');
    expect(quotaTone(100, 100)).toBe('primary');
    expect(quotaTone(0, 0)).toBe('muted');
  });

  it('renders the tone', async () => {
    await render(<QuotaMeter used={60} limit={100} />);
    expect(screen.getByTestId('quota-meter-premium')).toBeTruthy();
    expect(screen.getByText('60/100')).toBeTruthy();
  });
});
