import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/** Opens a public web page (legal) in the in-app browser tab; falls back to the system browser. */
export async function openWebPage(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
}
