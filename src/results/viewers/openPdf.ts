import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import type { File } from 'expo-file-system';
import { Platform } from 'react-native';

export type OpenPdfOutcome = 'opened' | 'no_app' | 'shared' | 'failed';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Android: ACTION_VIEW with the file's `contentUri` (FileProvider) so the system PDF viewer opens it.
 * iOS: the share sheet (QuickLook preview is in it). No PDF app on Android -> `no_app`; the caller
 * offers `shareInstead`.
 */
export async function openPdf(file: File): Promise<OpenPdfOutcome> {
  try {
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
        type: 'application/pdf',
      });
      return 'opened';
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    return 'shared';
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return /No Activity found|ActivityNotFound/i.test(msg) ? 'no_app' : 'failed';
  }
}

export async function sharePdf(file: File): Promise<boolean> {
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    return true;
  } catch {
    return false;
  }
}
