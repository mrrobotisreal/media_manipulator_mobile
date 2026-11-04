import { render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Sheet } from '../components/Sheet';

describe('Sheet', () => {
  it('gives its Modal window its own gesture-handler root (sliders inside receive touches)', async () => {
    await render(
      <Sheet visible onClose={() => {}}>
        <Text>body</Text>
      </Sheet>,
    );
    // An RN Modal is a separate native window on Android: without a root inside it, every
    // gesture-handler control in a sheet (Slider pans, double-tap resets) is dead.
    const root = screen.getByTestId('sheet-gesture-root');
    expect(within(root).getByTestId('sheet-panel')).toBeTruthy();
    expect(within(root).getByText('body')).toBeTruthy();
  });
});
