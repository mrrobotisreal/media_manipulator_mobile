/* eslint-disable @typescript-eslint/no-require-imports */
describe('entry background handler', () => {
  it('registers a no-op handler at import time when the build has Firebase', async () => {
    jest.resetModules();
    jest.doMock('@/lib/firebaseAvailable', () => ({ isFirebaseConfigured: () => true }));

    const m = require('@react-native-firebase/messaging');
    require('../background');
    expect(m.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
    const handler = m.setBackgroundMessageHandler.mock.calls[0][1];
    await expect(handler({})).resolves.toBeUndefined();
  });
  it('is inert without a Firebase config', () => {
    jest.resetModules();
    jest.doMock('@/lib/firebaseAvailable', () => ({ isFirebaseConfigured: () => false }));

    const m = require('@react-native-firebase/messaging');
    m.setBackgroundMessageHandler.mockClear();
    require('../background');
    expect(m.setBackgroundMessageHandler).not.toHaveBeenCalled();
  });
});
