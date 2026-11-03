import { fireEvent, render, screen } from '@testing-library/react-native';
import { TestCrashControl } from '../TestCrash';

describe('TestCrashControl', () => {
  it('test-crash control renders only in preview', async () => {
    const { rerender } = await render(<TestCrashControl taps={7} variant="production" />);
    expect(screen.queryByTestId('test-crash')).toBeNull();
    await rerender(<TestCrashControl taps={7} variant="development" />);
    expect(screen.queryByTestId('test-crash')).toBeNull();
    await rerender(<TestCrashControl taps={6} variant="preview" />);
    expect(screen.queryByTestId('test-crash')).toBeNull();
    const onCrash = jest.fn();
    await rerender(<TestCrashControl taps={7} variant="preview" onCrash={onCrash} />);
    await fireEvent.press(screen.getByTestId('test-crash'));
    expect(onCrash).toHaveBeenCalledTimes(1);
  });
});
