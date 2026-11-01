import type { ComponentType } from 'react';
import type { ResultKind } from '../describe';
import { ArchiveViewer } from './ArchiveViewer';
import { AudioViewer } from './AudioViewer';
import { GifViewer } from './GifViewer';
import { ImageViewer } from './ImageViewer';
import { PdfViewer } from './PdfViewer';
import { UnknownViewer } from './UnknownViewer';
import { VideoViewer } from './VideoViewer';
import type { ViewerProps } from './types';

export type { ViewerProps } from './types';

/**
 * Mirrors the web `RESULT_VIEWERS` keys. transcript/captions (MA20), metadata (MA21) and
 * summary/hls/dash (v1.1) are registered as neutral info cards until their viewers land.
 */
export const RESULT_VIEWERS: Partial<Record<ResultKind, ComponentType<ViewerProps>>> = {
  image: ImageViewer,
  gif: GifViewer,
  video: VideoViewer,
  audio: AudioViewer,
  pdf: PdfViewer,
  archive: ArchiveViewer,
  transcript: UnknownViewer,
  captions: UnknownViewer,
  metadata: UnknownViewer,
  summary: UnknownViewer,
  hls: UnknownViewer,
  dash: UnknownViewer,
  unknown: UnknownViewer,
};

export function viewerFor(kind: ResultKind): ComponentType<ViewerProps> {
  return RESULT_VIEWERS[kind] ?? UnknownViewer;
}
