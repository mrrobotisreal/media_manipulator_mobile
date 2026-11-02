import { render, screen } from '@testing-library/react-native';
import * as RN from 'react-native';
import { AppleLogo } from '../components/BrandMarks';

describe('AppleLogo', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is white in dark mode and black in light mode', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    await render(<AppleLogo />);
    expect(JSON.stringify(screen.toJSON())).toMatch(/#FFFFFF|4294967295/i);

    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    await render(<AppleLogo />);
    expect(JSON.stringify(screen.toJSON())).toMatch(/#000000|4278190080/i);
  });

  it('keeps the glyph aspect ratio', async () => {
    await render(<AppleLogo size={51} />);
    const svg = screen.getByTestId('apple-logo', { includeHiddenElements: true });
    expect(svg.props.width).toBeCloseTo(41.5);
    expect(svg.props.height).toBe(51);
  });
});
