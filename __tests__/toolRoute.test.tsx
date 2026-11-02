import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import ToolRoute from '../app/(app)/tool/[family]/[toolId]';
import { i18n } from '@/i18n';
import { makeReadyStore } from '@/state/testing';
import { getContext, track as realTrack } from '@/analytics/track';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
}));
jest.mock('lucide-react-native', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/analytics/track', () => {
  const actual = jest.requireActual('@/analytics/track');
  return { ...actual, track: jest.fn() };
});

async function renderRoute(params: Record<string, string>) {
  mockParams = params;
  const { store } = await makeReadyStore();
  const utils = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ToolRoute />
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...utils };
}

describe('tool route', () => {
  beforeEach(() => (realTrack as jest.Mock).mockClear());

  it('redirects an unknown tool and a family mismatch to the Tools tab', async () => {
    await renderRoute({ family: 'image', toolId: 'nope' });
    expect(screen.getByText('redirect:/(app)/(tabs)')).toBeTruthy();
    expect(realTrack).not.toHaveBeenCalled();
  });

  it('redirects when the family does not match the tool', async () => {
    await renderRoute({ family: 'video', toolId: 'image-resize' });
    expect(screen.getByText('redirect:/(app)/(tabs)')).toBeTruthy();
  });

  it('renders the scaffold, records a recent, fires tool_viewed once and clears context on unmount', async () => {
    const { store, unmount } = await renderRoute({
      family: 'image',
      toolId: 'image-resize',
      from: 'search',
    });
    expect(screen.getByText('Resize image')).toBeTruthy();
    expect(screen.getByText('Accepts: Images')).toBeTruthy();
    expect(screen.getByText('Keep aspect ratio')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(store.getState().settings.lastToolIds).toEqual(['image-resize']);
    expect(realTrack).toHaveBeenCalledTimes(1);
    expect(realTrack).toHaveBeenCalledWith('tool_viewed', { entry_point: 'search' });
    expect(getContext()).toMatchObject({ tool_slug: 'image-resizer', media_kind: 'image' });
    await unmount();
    expect(getContext().tool_slug).toBeUndefined();
  });

  it('defaults the entry point to deep_link and maps pdf to document', async () => {
    await renderRoute({ family: 'image', toolId: 'pdf-to-image' });
    expect(realTrack).toHaveBeenCalledWith('tool_viewed', { entry_point: 'deep_link' });
    expect(getContext()).toMatchObject({ tool_slug: 'pdf-to-jpg', media_kind: 'document' });
  });
});
