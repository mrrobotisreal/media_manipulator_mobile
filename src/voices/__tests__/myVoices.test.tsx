import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import MyVoicesScreen from '../../../app/(app)/(tabs)/account/voices';
import { i18n } from '@/i18n';

const voices = [
  {
    id: 'v-clone',
    name: 'Mitch',
    kind: 'cloned',
    languageHint: 'ru',
    engineVersion: '1',
    consentAt: '2026-11-07T10:00:00Z',
    createdAt: '2026-11-07T10:00:00Z',
    updatedAt: '',
  },
  {
    id: 'v-design',
    name: 'Narrator',
    kind: 'designed',
    languageHint: 'en',
    engineVersion: '1',
    consentAt: null,
    createdAt: '2026-11-06T10:00:00Z',
    updatedAt: '',
  },
];
let mockList: { data?: unknown; isLoading?: boolean; isError?: boolean; refetch: jest.Mock } = {
  refetch: jest.fn(),
};
const mockDelete = jest.fn((_id: string) => Promise.resolve({ data: { deleted: {}, pending: 0 } }));
const mockRename = jest.fn((_a: unknown) => Promise.resolve({ data: {} }));
jest.mock('@/api/endpoints/voices', () => ({
  useListVoicesQuery: () => mockList,
  useDeleteVoiceMutation: () => [(id: string) => mockDelete(id), { isLoading: false }],
  useRenameVoiceMutation: () => [(a: unknown) => mockRename(a), { isLoading: false }],
}));
jest.mock('@/voices/useVoicesCapabilities', () => ({
  useVoicesCapabilities: () => ({
    caps: {
      enabled: true,
      warm: true,
      languages: ['en', 'ru'],
      limits: { voicesSaved: 1, textMaxChars: 1080 },
    },
  }),
}));
jest.mock('@/voices/ui/VoiceCard', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    VoiceSummary: ({
      voice,
    }: {
      voice: { id: string; name: string; consentAt?: string | null };
    }) => (
      <Text>{`${voice.name}${voice.consentAt ? ' consent:' + voice.consentAt.slice(0, 10) : ''}`}</Text>
    ),
  };
});
jest.mock('@/voices/ui/SpeakPanel', () => ({ SpeakPanel: () => null }));
jest.mock('@/ui/notice', () => ({ showNotice: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/ui/components/ProcessingIndicator', () => ({}));
jest.mock('@/ui/components/ProgressBar', () => ({}));
jest.mock('@/ui/components/QuotaMeter', () => ({}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const open = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <MyVoicesScreen />
    </I18nextProvider>,
  );

beforeEach(() => {
  mockDelete.mockClear();
  mockRename.mockClear();
  mockList = { data: { voices, limit: 2, used: 2 }, refetch: jest.fn() };
});

describe('My voices (MA34 decision 9)', () => {
  it('lists the voices with the consent date of a cloned voice and used / limit', async () => {
    await open();
    expect(screen.getByText('Mitch consent:2026-11-07')).toBeTruthy();
    expect(screen.getByText('Narrator')).toBeTruthy();
    expect(screen.getByTestId('voices-usage')).toHaveTextContent('2 of 2 voices saved');
  });

  it('at the plan limit it says so neutrally', async () => {
    await open();
    expect(screen.getByTestId('voices-full')).toHaveTextContent(
      "You've saved 2 of 2 voices on your plan. Delete one to make room.",
    );
  });

  it('shows no limit line while there is room, and the unlimited readout for -1', async () => {
    mockList = { data: { voices, limit: -1, used: 2 }, refetch: jest.fn() };
    await open();
    expect(screen.queryByTestId('voices-full')).toBeNull();
    expect(screen.getByTestId('voices-usage')).toHaveTextContent('2 voices saved');
  });

  it('Delete asks first with the retention wording, and only the confirm deletes', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('voice-delete-v-clone'));
    expect(screen.getByTestId('delete-body')).toHaveTextContent(
      'The voice and its sample are deleted now. Speech you already generated stays until its own retention ends.',
    );
    expect(mockDelete).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-confirm'));
    });
    expect(mockDelete).toHaveBeenCalledWith('v-clone');
  });

  it('Rename sends the trimmed name for that voice', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('voice-rename-v-design'));
    await fireEvent.changeText(screen.getByTestId('rename-input'), '  Storyteller ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('rename-save'));
    });
    expect(mockRename).toHaveBeenCalledWith({ id: 'v-design', name: 'Storyteller' });
  });

  it('an empty list shows the empty copy', async () => {
    mockList = { data: { voices: [], limit: 1, used: 0 }, refetch: jest.fn() };
    await open();
    expect(screen.getByTestId('voices-empty')).toBeTruthy();
  });

  it('a failed load offers Retry', async () => {
    mockList = { isError: true, refetch: jest.fn() };
    await open();
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockList.refetch).toHaveBeenCalled();
  });

  it('offers Speak with this voice on each voice while the server is enabled', async () => {
    await open();
    expect(screen.getByTestId('voice-speak-v-clone')).toBeTruthy();
  });
});
