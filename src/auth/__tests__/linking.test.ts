import * as FB from '@react-native-firebase/auth';
import { linkWithCredential, type User } from '@react-native-firebase/auth';
import { appleLinkOfferSet, linkPromptSet, noticeSet } from '@/state/slices/auth';
import {
  completePendingLink,
  hasPendingLink,
  linkProviderOptions,
  setPendingLink,
} from '../linking';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

const user = { uid: 'u' } as User;

describe('linking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('links the pending credential after the other provider signs in', async () => {
    const cred = { providerId: 'google.com' } as never;
    setPendingLink({ credential: cred, method: 'google' });
    (linkWithCredential as jest.Mock).mockResolvedValue({});
    const dispatch = jest.fn();
    await completePendingLink(user, dispatch);
    expect(FB.linkWithCredential).toHaveBeenCalledWith(user, cred);
    expect(dispatch).toHaveBeenCalledWith(noticeSet('linked'));
    expect(hasPendingLink()).toBe(false);
  });

  it('without a credential (Android Apple) offers Link Apple', async () => {
    setPendingLink({ credential: null, method: 'apple' });
    const dispatch = jest.fn();
    await completePendingLink(user, dispatch);
    expect(FB.linkWithCredential).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(appleLinkOfferSet(true));
    expect(dispatch).toHaveBeenCalledWith(linkPromptSet(null));
  });

  it('a link failure never throws', async () => {
    setPendingLink({ credential: {} as never, method: 'google' });
    (linkWithCredential as jest.Mock).mockRejectedValue({ code: 'auth/credential-already-in-use' });
    await expect(completePendingLink(user, jest.fn())).resolves.toBeUndefined();
  });

  it('offers every other provider when the lookup is empty (enumeration protection)', async () => {
    expect(await linkProviderOptions('a@b.co', 'google', async () => [])).toEqual([
      'apple',
      'email',
    ]);
  });

  it('uses the provider list when Firebase returns one', async () => {
    expect(await linkProviderOptions('a@b.co', 'apple', async () => ['password'])).toEqual([
      'email',
    ]);
  });
});
