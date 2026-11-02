import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { accountApi } from '@/api/endpoints/account';
import { tiersApi } from '@/api/endpoints/tiers';
import { i18n } from '@/i18n';
import { SNAPSHOT, TIERS } from '@/quota/testFixtures';
import { makeReadyStore } from '@/state/testing';
import * as o from '../../../options/image';
import type { ToolContext } from '../../../types';
import { ImageConvertForm } from '../ImageConvertForm';
import { ImageResizeForm } from '../ImageResizeForm';
import { ImageTextForm } from '../ImageTextForm';
import { PdfToImageForm } from '../PdfToImageForm';
import { TOOL_BY_ID } from '../../../registry';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

async function wrap(ui: React.ReactElement, tier = 'free') {
  const { store } = await makeReadyStore();
  await store.dispatch(
    accountApi.util.upsertQueryData('getAccountMe', undefined, {
      tier,
      emailVerified: true,
      anonymous: false,
      limits: SNAPSHOT.limits,
      usage: { ops: 1 },
      resetsAt: '2099-01-01T00:00:00Z',
    }),
  );
  await store.dispatch(
    tiersApi.util.upsertQueryData('getTiers', undefined, {
      tiers: TIERS,
      premiumPurchasable: true,
      proPurchasable: true,
      defaultCurrency: 'usd',
      prices: {
        usd: { premiumMonthly: 1, premiumYearly: 1, proMonthly: 1, proYearly: 1 },
        eur: { premiumMonthly: 1, premiumYearly: 1, proMonthly: 1, proYearly: 1 },
      },
    }),
  );
  await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Provider>,
  );
}

const ctx = (extension = 'jpg', maxOutputHeight = 1440): ToolContext => ({
  input: { name: `a.${extension}`, extension, mime: '', mediaKind: 'image' },
  limits: { maxOutputHeight },
});

describe('ImageResizeForm + height gate', () => {
  const resize = TOOL_BY_ID.get('image-resize')!;
  it('shows the limit hint and blocks Run for height 2000 on a 1440 plan', async () => {
    const form: o.ResizeForm = {
      ...o.resizeDefaults,
      width: undefined,
      height: 2000,
      lastEdited: 'height',
    };
    await wrap(<ImageResizeForm value={form} onChange={jest.fn()} ctx={ctx()} />);
    expect(screen.getByText('Up to 1440p on your plan.')).toBeTruthy();
    expect(screen.getByTestId('height-limit-fact')).toBeTruthy();
    expect(resize.blockReason!(form, ctx())).toBe('output_height');
  });

  it('allows a width-only 3000 request', async () => {
    const form: o.ResizeForm = {
      ...o.resizeDefaults,
      width: 3000,
      height: 2000,
      lastEdited: 'width',
    };
    await wrap(<ImageResizeForm value={form} onChange={jest.fn()} ctx={ctx()} />);
    expect(screen.queryByText('Up to 1440p on your plan.')).toBeNull();
    expect(resize.blockReason!(form, ctx())).toBeNull();
  });

  it('typing a height marks it as the last edited dimension', async () => {
    const onChange = jest.fn();
    await wrap(<ImageResizeForm value={o.resizeDefaults} onChange={onChange} ctx={ctx()} />);
    fireEvent.changeText(screen.getByLabelText('Height'), '600');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ height: 600, lastEdited: 'height' }),
    );
  });
});

describe('ImageConvertForm', () => {
  it('shows quality only for jpg and webp, ico sizes only for ico', async () => {
    const view = (format: o.ConvertForm['format']) => (
      <ImageConvertForm value={{ ...o.convertDefaults, format }} onChange={jest.fn()} />
    );
    await wrap(view('jpg'));
    expect(screen.getByLabelText('Quality')).toBeTruthy();
    expect(screen.queryByLabelText('Icon sizes')).toBeNull();
    screen.unmount();
    await wrap(view('webp'));
    expect(screen.getByLabelText('Quality')).toBeTruthy();
    screen.unmount();
    await wrap(view('png'));
    expect(screen.queryByLabelText('Quality')).toBeNull();
    screen.unmount();
    await wrap(view('ico'));
    expect(screen.queryByLabelText('Quality')).toBeNull();
    expect(screen.getByLabelText('Icon sizes')).toBeTruthy();
  });
});

describe('ImageTextForm', () => {
  it('blocks Run on empty text and releases it with text', async () => {
    const text = TOOL_BY_ID.get('image-text')!;
    await wrap(<ImageTextForm value={o.textDefaults} onChange={jest.fn()} />);
    expect(screen.getByText('Enter the text to add')).toBeTruthy();
    expect(text.blockReason!(o.textDefaults)).toBe('text_required');
    expect(text.blockReason!({ ...o.textDefaults, text: 'Hi' })).toBeNull();
    expect(text.blockReason!({ ...o.textDefaults, text: '   ' })).toBe('text_required');
  });
});

describe('PdfToImageForm', () => {
  it('hides quality for png', async () => {
    await wrap(<PdfToImageForm value={o.pdfToImageDefaults} onChange={jest.fn()} />);
    expect(screen.getByLabelText('Quality')).toBeTruthy();
    screen.unmount();
    await wrap(
      <PdfToImageForm value={{ ...o.pdfToImageDefaults, format: 'png' }} onChange={jest.fn()} />,
    );
    expect(screen.queryByLabelText('Quality')).toBeNull();
  });
});
