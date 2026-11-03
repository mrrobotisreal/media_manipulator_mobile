import { PermissionStatus } from 'expo-notifications';
import { fromResponse } from '../permission';

describe('fromResponse (OS permission -> app state)', () => {
  it('a never-asked Android 13+ permission (denied, canAskAgain) is undetermined, so the pre-prompt can ask', () => {
    expect(fromResponse({ status: PermissionStatus.DENIED, canAskAgain: true })).toBe(
      'undetermined',
    );
  });
  it('a refused permission (denied, cannot ask again) is denied -> "Open settings"', () => {
    expect(fromResponse({ status: PermissionStatus.DENIED, canAskAgain: false })).toBe('denied');
  });
  it('granted and undetermined map through', () => {
    expect(fromResponse({ status: PermissionStatus.GRANTED, canAskAgain: true })).toBe('granted');
    expect(fromResponse({ status: PermissionStatus.UNDETERMINED, canAskAgain: true })).toBe(
      'undetermined',
    );
  });
});
