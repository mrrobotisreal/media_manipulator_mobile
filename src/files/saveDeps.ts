/* eslint-disable @typescript-eslint/no-require-imports */
import { Directory, File, FileMode } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { evictResult } from '@/results/cache';
import { store } from '@/state/store';
import { saveDirSet } from '@/state/slices/settings';
import { COPY_CHUNK, folderLabel, type SaveDeps } from './save';

/**
 * Real native bindings for `saveResult` (expo-media-library `Asset`/`Album`, SDK 57 `Directory.pickDirectoryAsync`,
 * expo-sharing). Kept out of `save.ts` so its tests need no native modules. The media library is required lazily.
 */
export function realSaveDeps(): SaveDeps {
  const media = () => require('expo-media-library') as typeof import('expo-media-library');
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    hasPhotosPermission: async () => (await media().getPermissionsAsync(true, [])).granted,
    requestPhotosPermission: async () => (await media().requestPermissionsAsync(true, [])).granted,
    addToPhotos: async (fileUri, album) => {
      const m = media();
      if (album) await m.Album.create(album, [fileUri]);
      else await m.Asset.create(fileUri);
    },
    getSaveDir: () => store.getState().settings.lastSaveDirUri,
    setSaveDir: (uri) => void store.dispatch(saveDirSet(uri)),
    pickDirectory: async (initialUri) => {
      try {
        const dir = await Directory.pickDirectoryAsync(initialUri);
        return { uri: dir.uri, name: dir.name };
      } catch (e) {
        if (/cancel/i.test(e instanceof Error ? e.message : '')) return null;
        throw e;
      }
    },
    writeToDirectory: async (dirUri, name, mime, source) => {
      const dir = new Directory(dirUri);
      const target = dir.createFile(name, mime);
      const reader = source.open(FileMode.ReadOnly);
      const writer = target.open(FileMode.WriteOnly);
      try {
        for (;;) {
          const chunk = reader.readBytes(COPY_CHUNK);
          if (chunk.length === 0) break;
          writer.writeBytes(chunk);
        }
      } catch (e) {
        try {
          target.delete();
        } catch {
          // partial file; best effort
        }
        throw e;
      } finally {
        reader.close();
        writer.close();
      }
      return { folder: folderLabel(dir.name || dirUri) };
    },
    share: async (file: File, mime, title) => {
      await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: title });
    },
    evictCache: evictResult,
  };
}
