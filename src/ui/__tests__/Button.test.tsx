import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button } from '../components/Button';

describe('Button', () => {
  it('has button role and min height 44', async () => {
    await render(<Button label="Go" />);
    const b = screen.getByRole('button');
    expect(StyleSheet.flatten(b.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('fires onPress, but not when disabled or loading', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<Button label="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<Button label="Go" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button'));
    await rerender(<Button label="Go" onPress={onPress} loading />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ busy: true });
  });
});
