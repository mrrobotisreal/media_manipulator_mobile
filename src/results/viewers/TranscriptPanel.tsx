import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { formatDuration } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Num, Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { showNotice } from '@/ui/notice';
import { formatTimestamp, type Cue } from '../captions';
import {
  copyTranscript,
  exportTranscript,
  realTranscriptDeps,
  type TranscriptActionDeps,
} from '../transcriptActions';
import type { TranscriptFormat } from '../transcriptFormats';
import { EXPORT_FORMATS, filterCues, type TranscriptSource } from '../transcriptModel';
import { languageName } from '../../tools/forms/ai/languages';
import { getActiveLocale } from '@/i18n';

export interface TranscriptPanelProps {
  source: TranscriptSource;
  /** Server result file name (`talk.vtt`); export names derive from it. */
  fileName: string;
  jobId: string;
  /** Why there is nothing to list (no audio / no speech). */
  emptyReason?: 'noAudio' | 'noSpeech' | null;
  deps?: TranscriptActionDeps;
  /** Slot under the stats (the AI summary). */
  children?: React.ReactNode;
}

const CueRow = ({ cue }: { cue: Cue }) => (
  <View className="flex-row gap-3 py-2" testID="cue-row">
    <Num className="w-14 text-sm text-muted-fg">{formatTimestamp(cue.startMs, 'display')}</Num>
    <Text className="flex-1">{cue.text}</Text>
  </View>
);

/**
 * Header stats, search, copy-all, export-as, and a virtualized cue list. Tapping a cue does not seek (no
 * source player in v1), so `transcript_cue_seeked` is never emitted. The list is a FlatList so a 2-hour
 * video (thousands of cues) stays smooth; export builds its string once, on demand.
 */
export function TranscriptPanel({
  source,
  fileName,
  jobId,
  emptyReason = null,
  deps,
  children,
}: TranscriptPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const actions = useMemo(() => deps ?? realTranscriptDeps(), [deps]);
  const visible = useMemo(() => filterCues(source.cues, query), [source.cues, query]);

  const onCopy = async () => {
    try {
      await copyTranscript(source, actions);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showNotice(t('result.transcript.exportFailed'), 'error');
    }
  };
  const onExport = async (format: TranscriptFormat) => {
    setExporting(true);
    try {
      await exportTranscript(source, format, fileName, jobId, actions);
    } catch {
      showNotice(t('result.transcript.exportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const empty = source.cues.length === 0;
  return (
    <View className="gap-3" testID="transcript-panel">
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {source.language ? (
          <Text className="text-sm text-muted-fg">
            {t('result.transcript.language')}: {languageName(source.language, getActiveLocale())}
          </Text>
        ) : null}
        {source.durationSeconds ? (
          <Num className="text-sm text-muted-fg">
            {t('result.transcript.duration')}: {formatDuration(source.durationSeconds)}
          </Num>
        ) : null}
        <Num className="text-sm text-muted-fg" testID="cue-count">
          {t('result.transcript.cues', { count: source.cues.length })}
        </Num>
      </View>
      {children}
      {emptyReason === 'noAudio' ? (
        <Text className="text-muted-fg">{t('interface:transcribeResultView.noAudioStream')}</Text>
      ) : emptyReason === 'noSpeech' ? (
        <Text className="text-muted-fg" testID="no-speech">
          {t('interface:transcribeResultView.noSpeech')}
        </Text>
      ) : empty ? (
        <Text className="text-muted-fg">{t('result.transcript.empty')}</Text>
      ) : (
        <>
          <TextField
            label={t('result.transcript.search')}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <View className="flex-row gap-2">
            <Button
              variant="secondary"
              label={copied ? t('result.transcript.copied') : t('result.transcript.copyAll')}
              onPress={() => void onCopy()}
            />
          </View>
          <Text className="text-sm text-muted-fg">{t('result.transcript.export')}</Text>
          <Chips
            label={t('result.transcript.export')}
            options={EXPORT_FORMATS.map((f) => ({
              value: f,
              label: t('result.transcript.exportAs', { format: f.toUpperCase() }),
            }))}
            value={null}
            onChange={(f) => {
              if (!exporting) void onExport(f);
            }}
          />
          {visible.length === 0 ? (
            <Text className="text-muted-fg" testID="no-matches">
              {t('result.transcript.noMatches')}
            </Text>
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(c) => String(c.index)}
              renderItem={({ item }) => <CueRow cue={item} />}
              style={{ maxHeight: 420 }}
              nestedScrollEnabled
              initialNumToRender={30}
              maxToRenderPerBatch={40}
              windowSize={7}
              testID="cue-list"
            />
          )}
        </>
      )}
    </View>
  );
}
