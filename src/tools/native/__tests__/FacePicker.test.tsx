import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { faceDetectionResponseSchema } from '@/api/schemas/faces';
import { FacePicker } from '../FacePicker';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const FIXTURE = faceDetectionResponseSchema.parse({
  faceDetectionSessionId: 'fd_abc',
  imageWidth: 4000,
  imageHeight: 3000,
  expiresAt: '2026-11-02T12:30:00Z',
  faces: [
    { id: 'face_1', index: 1, confidence: 0.99, x: 0.1, y: 0.2, width: 0.2, height: 0.25 },
    { id: 'face_2', index: 2, x: 0.5, y: 0.2, width: 0.01, height: 0.01 },
    { id: 'face_3', index: 3, x: 0.7, y: 0.5, width: 0.1, height: 0.15 },
  ],
});

async function setup(selected: string[] = [], onToggle = jest.fn()) {
  await render(
    <I18nextProvider i18n={i18n}>
      <FacePicker
        uri="file:///a.jpg"
        imageWidth={FIXTURE.imageWidth}
        imageHeight={FIXTURE.imageHeight}
        faces={FIXTURE.faces}
        selected={selected}
        onToggle={onToggle}
        onSelectAll={jest.fn()}
        onClear={jest.fn()}
      />
    </I18nextProvider>,
  );
  await act(async () => {
    fireEvent(screen.getByTestId('face-canvas'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } },
    });
  });
  return onToggle;
}

describe('FacePicker', () => {
  it('renders one box per detected face with the count', async () => {
    await setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByTestId('face-count').props.children).toContain('3');
  });

  it('toggles a face on tap and reflects the selected state for accessibility', async () => {
    const onToggle = await setup(['face_3']);
    fireEvent.press(screen.getByTestId('face-face_1'));
    expect(onToggle).toHaveBeenCalledWith('face_1');
    expect(screen.getByTestId('face-face_3').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('face-face_1').props.accessibilityState.checked).toBe(false);
  });

  it('gives a tiny face a 44 pt hit area', async () => {
    await setup();
    const style = screen.getByTestId('face-face_2').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(5)) : style;
    expect(flat.width).toBeGreaterThanOrEqual(44);
    expect(flat.height).toBeGreaterThanOrEqual(44);
  });

  it('rejects a malformed detection as a failed parse, not a crash', () => {
    expect(faceDetectionResponseSchema.safeParse({ faces: 'nope' }).success).toBe(false);
    expect(
      faceDetectionResponseSchema.parse({
        faceDetectionSessionId: 'x',
        imageWidth: 1,
        imageHeight: 1,
        expiresAt: 't',
        faces: null,
      }).faces,
    ).toEqual([]);
  });
});
