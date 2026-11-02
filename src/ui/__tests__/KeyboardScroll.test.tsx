import { render, screen } from '@testing-library/react-native';
import { Keyboard, Text } from 'react-native';
import { KeyboardScroll } from '../components/KeyboardScroll';

describe('KeyboardScroll', () => {
  it('renders children inside a keyboard-avoiding scroll view that keeps taps while typing', async () => {
    await render(
      <KeyboardScroll contentContainerClassName="gap-4">
        <Text>field</Text>
      </KeyboardScroll>,
    );
    expect(screen.getByText('field')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('"keyboardShouldPersistTaps":"handled"');
  });

  it('listens for the keyboard and stops listening on unmount', async () => {
    const remove = jest.fn();
    const spy = jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove } as never);
    const { unmount } = await render(
      <KeyboardScroll>
        <Text>x</Text>
      </KeyboardScroll>,
    );
    expect(spy).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    await unmount();
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });
});
