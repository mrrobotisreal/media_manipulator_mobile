import { File, UploadType } from 'expo-file-system';
import type { MakeUploadTask } from './transport';

/**
 * The only importer of expo-file-system's upload API (jest injects a fake instead).
 * `sessionType` is iOS-only: 'background' lets the native transfer continue while suspended;
 * Android ignores it and the upload continues while the process lives.
 */
export const makeUploadTask: MakeUploadTask = (uri, url, o) =>
  new File(uri).createUploadTask(url, {
    httpMethod: o.method,
    uploadType: o.multipart ? UploadType.MULTIPART : UploadType.BINARY_CONTENT,
    headers: o.headers,
    fieldName: o.fieldName,
    mimeType: o.mimeType,
    parameters: o.parameters,
    sessionType: o.sessionType,
    onProgress: o.onProgress,
    signal: o.signal,
  });
