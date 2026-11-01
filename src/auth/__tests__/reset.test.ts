import { track } from '@/analytics/track';
import { requestPasswordReset } from '../reset';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

describe('reset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends and emits password_reset_requested once', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    expect(await requestPasswordReset(' a@b.co ', send)).toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledWith('a@b.co');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('password_reset_requested', { surface: 'app' });
  });

  it('user-not-found still ends in the neutral confirmation', async () => {
    const send = jest.fn().mockRejectedValue({ code: 'auth/user-not-found' });
    expect(await requestPasswordReset('a@b.co', send)).toEqual({ status: 'sent' });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('malformed email errors without reaching Firebase or emitting', async () => {
    const send = jest.fn();
    expect(await requestPasswordReset('nope', send)).toEqual({
      status: 'error',
      errorKey: 'invalidEmail',
    });
    expect(send).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('network failure is an inline error', async () => {
    const send = jest.fn().mockRejectedValue({ code: 'auth/network-request-failed' });
    expect(await requestPasswordReset('a@b.co', send)).toEqual({
      status: 'error',
      errorKey: 'network',
    });
  });
});
