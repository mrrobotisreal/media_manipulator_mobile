import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { ActionsBar, type ActionsBarProps, type ResultActions } from '../ActionsBar';

jest.mock('@/ui/components/ProgressBar', () => ({ ProgressBar: () => null }));

function fake(over: Partial<ResultActions> = {}): ResultActions {
  return {
    sheet: null,
    setSheet: jest.fn(),
    progress: null,
    converting: false,
    working: false,
    save: jest.fn(),
    share: jest.fn(),
    copyShareLink: jest.fn(),
    revokeLinks: jest.fn(),
    downloadMp3: jest.fn(),
    remove: jest.fn(),
    runAnother: jest.fn(),
    openSettings: jest.fn(),
    saveToFilesInstead: jest.fn(),
    ...over,
  } as ResultActions;
}

async function setup(props: Partial<ActionsBarProps> = {}, actions = fake()) {
  await render(
    <I18nextProvider i18n={i18n}>
      <ActionsBar actions={actions} canShareLink canMp3={false} canRunAnother {...props} />
    </I18nextProvider>,
  );
  return actions;
}

describe('ActionsBar', () => {
  it('lays out Save, Share, More in that order', async () => {
    await setup();
    const labels = screen.getAllByRole('button').map((b) => b.props.testID);
    expect(labels).toEqual(['action-save', 'action-share', 'action-more']);
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('wires the buttons', async () => {
    const a = await setup();
    await fireEvent.press(screen.getByTestId('action-save'));
    await fireEvent.press(screen.getByTestId('action-share'));
    await fireEvent.press(screen.getByTestId('action-more'));
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(a.share).toHaveBeenCalledTimes(1);
    expect(a.setSheet).toHaveBeenCalledWith('more');
  });

  it('disables Share and More and shows the percentage while a download runs', async () => {
    const a = await setup({}, fake({ progress: 0.42, working: true }));
    expect(screen.getByText('Downloading… 42%')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-share'));
    await fireEvent.press(screen.getByTestId('action-more'));
    await fireEvent.press(screen.getByTestId('action-save'));
    expect(a.share).not.toHaveBeenCalled();
    expect(a.setSheet).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
  });

  it('shows the converting line during an MP3 conversion', async () => {
    await setup({}, fake({ converting: true, working: true }));
    expect(screen.getByText('Converting to MP3…')).toBeTruthy();
  });

  it('More sheet: share link, MP3 and run another depend on the result', async () => {
    await setup(
      { canShareLink: false, canMp3: false, canRunAnother: false },
      fake({ sheet: 'more' }),
    );
    expect(screen.queryByTestId('action-share-link')).toBeNull();
    expect(screen.queryByTestId('action-mp3')).toBeNull();
    expect(screen.queryByTestId('action-run-another')).toBeNull();
    expect(screen.getByTestId('action-delete')).toBeTruthy();
  });

  it('More sheet: every item for a shareable vocal-stem WAV', async () => {
    const a = await setup({ canMp3: true }, fake({ sheet: 'more' }));
    expect(screen.getByText('Copy share link')).toBeTruthy();
    expect(screen.getByText('Download as MP3')).toBeTruthy();
    expect(screen.getByText('Run another')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-mp3'));
    await fireEvent.press(screen.getByTestId('action-share-link'));
    await fireEvent.press(screen.getByTestId('action-run-another'));
    await fireEvent.press(screen.getByTestId('action-delete'));
    expect(a.downloadMp3).toHaveBeenCalled();
    expect(a.copyShareLink).toHaveBeenCalled();
    expect(a.runAnother).toHaveBeenCalled();
    expect(a.setSheet).toHaveBeenCalledWith('delete');
  });

  it('permission sheet offers Open settings and Save to Files instead', async () => {
    const a = await setup({}, fake({ sheet: 'permission' }));
    expect(screen.getByText('Allow Media Manipulator to add photos')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-files-instead'));
    expect(a.saveToFilesInstead).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Open settings'));
    expect(a.openSettings).toHaveBeenCalled();
  });

  it('limit sheet revokes; delete sheet confirms', async () => {
    const a = await setup({}, fake({ sheet: 'limit' }));
    expect(screen.getByText('Share limit reached')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-revoke'));
    expect(a.revokeLinks).toHaveBeenCalled();

    const b = await setup({}, fake({ sheet: 'delete' }));
    expect(screen.getAllByText('Delete this result?').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByTestId('action-delete-confirm')[0]!);
    expect(b.remove).toHaveBeenCalled();
  });
});
