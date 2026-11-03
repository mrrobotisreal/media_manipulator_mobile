import { JOB_UPDATES_CHANNEL, ensureJobUpdatesChannel } from '../channel';

describe('job_updates channel', () => {
  it('creates the channel with the id MA23 targets on Android', async () => {
    const setChannel = jest.fn(async () => null);
    await ensureJobUpdatesChannel('Job updates', { os: 'android', setChannel });
    expect(JOB_UPDATES_CHANNEL).toBe('job_updates');
    expect(setChannel).toHaveBeenCalledWith('job_updates', 'Job updates');
  });
  it('does nothing on iOS and never throws', async () => {
    const setChannel = jest.fn(async () => null);
    await ensureJobUpdatesChannel('x', { os: 'ios', setChannel });
    expect(setChannel).not.toHaveBeenCalled();
    await expect(
      ensureJobUpdatesChannel('x', {
        os: 'android',
        setChannel: () => Promise.reject(new Error('x')),
      }),
    ).resolves.toBeUndefined();
  });
});
