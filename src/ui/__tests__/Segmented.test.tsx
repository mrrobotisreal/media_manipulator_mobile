import { fireEvent, render, screen } from '@testing-library/react-native';
import { Segmented } from '../components/Segmented';

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];
  it('exposes tablist/tab roles and selection', async () => {
    await render(<Segmented options={options} value="a" onChange={() => {}} />);
    expect(screen.getByTestId('segmented').props.accessibilityRole).toBe('tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(
      screen.getAllByRole('tab')[0]?.props['aria-selected'] ??
        screen.getAllByRole('tab')[0]?.props.accessibilityState?.selected,
    ).toBe(true);
  });
  it('calls onChange', async () => {
    const onChange = jest.fn();
    await render(<Segmented options={options} value="a" onChange={onChange} />);
    await fireEvent.press(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
