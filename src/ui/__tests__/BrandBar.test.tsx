import { render, screen } from '@testing-library/react-native';
import { BrandBar } from '../components/BrandBar';

describe('BrandBar', () => {
  it('shows the aperture mark and the name, with nothing to tap', async () => {
    await render(<BrandBar />);
    expect(screen.getByLabelText('Media Manipulator')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
