import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components/Text';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { MAX_CAPTION_BYTES, captionSource, type TranscriptSource } from '../transcriptModel';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import { TranscriptPanel } from './TranscriptPanel';
import type { ViewerProps } from './types';

/**
 * Kind `captions` for a `.srt`/`.vtt` with no transcript JSON (history re-open, converted captions):
 * downloads the file (MA14 cache helper; capped at 5 MB like the web), parses it with `parseCaptions`, and
 * shows the same list / search / copy / export UI.
 */
export function CaptionsViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const tooLarge = (descriptor.sizeBytes ?? 0) > MAX_CAPTION_BYTES;
  const { state, reload } = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
    !tooLarge,
  );
  const [source, setSource] = useState<TranscriptSource | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (state.status !== 'ready') return;
    let live = true;
    state.file
      .text()
      .then((text) => {
        if (!live) return;
        if (text.length > MAX_CAPTION_BYTES) return setBad(true);
        const ext = descriptor.fileName.split('.').pop()?.toLowerCase();
        setSource(captionSource(text, ext === 'vtt' ? 'vtt' : ext === 'srt' ? 'srt' : undefined));
        trackResultPreviewed(context, 'captions');
      })
      .catch(() => live && setBad(true));
    return () => {
      live = false;
    };
  }, [state, descriptor.fileName, context]);

  if (tooLarge || bad) {
    return <Text className="py-4 text-muted-fg">{t('result.transcript.tooLarge')}</Text>;
  }
  if (state.status !== 'ready') return <LoadState state={state} onRetry={reload} />;
  if (!source) return null;
  return (
    <TranscriptPanel source={source} fileName={descriptor.fileName} jobId={descriptor.jobId} />
  );
}
