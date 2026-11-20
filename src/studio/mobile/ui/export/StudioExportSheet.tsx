/**
 * The Darkroom export sheet (ticket MA58 decision 2): built from `GET /studio/export-options`
 * (the output table; the app keeps no copy). Presets first (the web's output presets, then the
 * quality presets), "Advanced" expands container / video / audio / bitrate / channels, plus
 * resolution, captions mode and loudness. Locked entries stay listed, greyed, with the MA-0008
 * neutral line "Not on your plan" (no purchase link); pressing one reports
 * `studio_export_format_locked`. Start hands the request to the `studioExport` job starter and
 * opens the job screen (MA12 tracking, MA13 result, MA16 refusal sheets).
 */
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { useGetAccountMeQuery } from '@/api/hooks';
import type { StudioOutputTable, StudioProjectSummary } from '@/api/schemas/studio';
import { DARKROOM_TOOL_SLUG } from '@/jobs/starters/studioExport';
import { studioCaptionAnimation, studioHasCaptions } from '@/projects/merge';
import { useGetStudioExportOptionsQuery } from '@/studio/mobile/api';
import { Button } from '@/ui/components/Button';
import { Chips, type ChipOption } from '@/ui/components/Chips';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { colors } from '@/ui/tokens';
import {
  accessOf,
  bitrateOptions,
  buildExportRequest,
  choiceLock,
  choiceOutput,
  codecOptions,
  containerFile,
  containerOptions,
  defaultChoices,
  EMBEDDED_SUBS_TOKEN,
  exportProps,
  fitChoice,
  isAudioOnlyContainer,
  LOUDNESS,
  lockFor,
  outputWarnings,
  presetRows,
  QUALITIES,
  resolutionOptions,
  tokenName,
  type CaptionsMode,
  type ExportChoices,
  type OptionLock,
  type OutputAccess,
  type OutputChoice,
} from './exportModel';
import { startStudioExportJob } from './startStudioExport';

const LOUDNESS_KEY = {
  none: 'loudnessNone',
  streaming: 'loudnessStreaming',
  podcast: 'loudnessPodcast',
  broadcast: 'loudnessBroadcast',
} as const;
const QUALITY_KEY = { high: 'qualityHigh', medium: 'qualityMedium', low: 'qualityLow' } as const;

function reportLock(lock: OptionLock, access: OutputAccess) {
  const required = lock.required;
  if (required !== 'free' && required !== 'premium' && required !== 'pro') return;
  track(
    EVENTS.STUDIO_EXPORT_FORMAT_LOCKED,
    { option: lock.option, required, tier: access.tier, host: 'mm' },
    { tool_slug: DARKROOM_TOOL_SLUG, feature: 'studio' },
  );
}

function Label({ children }: { children: string }) {
  return <Text className="text-sm text-muted-fg">{children}</Text>;
}

// i18n-keys: interface:contentStudio.export.qualityHigh, interface:contentStudio.export.qualityMedium, interface:contentStudio.export.qualityLow, interface:contentStudio.export.loudnessNone, interface:contentStudio.export.loudnessStreaming, interface:contentStudio.export.loudnessPodcast, interface:contentStudio.export.loudnessBroadcast
export function ExportForm({
  table,
  access,
  project,
  maxOutputHeight,
  onStart,
}: {
  table: StudioOutputTable;
  access: OutputAccess;
  project: StudioProjectSummary;
  maxOutputHeight?: number;
  onStart(c: ExportChoices): void;
}) {
  const { t } = useTranslation();
  const hasCaptions = studioHasCaptions(project);
  const [c, setC] = useState<ExportChoices>(() =>
    defaultChoices(table, access, project.name.trim(), hasCaptions),
  );
  const set = (p: Partial<ExportChoices>) => setC((prev) => ({ ...prev, ...p }));
  const out = choiceOutput(c, table);
  const audio = isAudioOnlyContainer(out.container, table);
  const lock = choiceLock(c, table, access);
  const warnings = outputWarnings(out, table);
  const resOptions = resolutionOptions(project.height || 1080, maxOutputHeight);
  const resOverCap = resOptions.find((o) => o.value === c.resolution)?.overCap ?? false;

  const presetLabel = (key: string) =>
    t(`interface:contentStudio.export.preset_${key}`, { defaultValue: key });

  const presets = presetRows(table, access);
  const presetChips: ChipOption<string>[] = presets.map((r) => ({
    value: r.preset.key,
    label: presetLabel(r.preset.key),
    locked: r.lock !== null,
  }));

  const pickerChips = (
    opts: { value: string; lock: OptionLock | null }[],
    name: (v: string) => string,
  ): ChipOption<string>[] => opts.map((o) => ({ value: o.value, label: name(o.value), locked: o.lock !== null }));
  const lockOf = (opts: { value: string; lock: OptionLock | null }[], v: string) =>
    opts.find((o) => o.value === v)?.lock ?? null;
  const onLocked = (l: OptionLock | null) => l && reportLock(l, access);

  const containers = containerOptions(table, access);
  const videos = codecOptions('video', out, table, access);
  const audios = codecOptions('audio', out, table, access);
  const rates = bitrateOptions(out.audioCodec, table);
  const setOutput = (o: Partial<OutputChoice>) =>
    set({ output: fitChoice({ ...c.output, ...o }, table) });
  const advancedLock = lockFor([], access, true);

  const captionsOptions: ChipOption<CaptionsMode>[] = [
    { value: 'none', label: t('interface:contentStudio.export.captionsNone') },
    { value: 'burn_in', label: t('interface:contentStudio.export.captionsBurnIn') },
    {
      value: 'embedded',
      label: t('interface:contentStudio.export.captionsEmbedded'),
      locked: lockFor([EMBEDDED_SUBS_TOKEN], access) !== null,
    },
  ];

  return (
    <View className="gap-3">
      <TextField
        label={t('interface:contentStudio.export.fileName')}
        value={c.fileName}
        onChangeText={(fileName) => set({ fileName })}
        maxLength={120}
        testID="studio-export-file-name"
      />
      <ToggleRow
        label={t('interface:contentStudio.export.advanced')}
        value={c.mode === 'advanced'}
        onChange={(on) => {
          if (on && advancedLock) {
            onLocked(advancedLock);
            return;
          }
          set(on ? { mode: 'advanced', output: fitChoice(out, table) } : { mode: 'preset' });
        }}
      />
      {advancedLock ? (
        <Text className="text-sm text-subtle" testID="studio-export-advanced-locked">
          {t('interface:contentStudio.export.advanced')} · {t('darkroom.export.notOnPlan')}
        </Text>
      ) : null}
      {c.mode === 'preset' ? (
        <>
          <Label>{t('interface:contentStudio.export.format')}</Label>
          <Chips
            options={presetChips}
            value={c.outputPreset}
            onChange={(outputPreset) => set({ outputPreset })}
            onLockedPress={(key) => onLocked(presets.find((r) => r.preset.key === key)?.lock ?? null)}
            testIDPrefix="studio-export-preset"
          />
        </>
      ) : (
        <>
          <Label>{t('interface:contentStudio.export.container')}</Label>
          <Chips
            options={pickerChips(containers, (v) => v.toUpperCase())}
            value={out.container}
            onChange={(container) => setOutput({ container })}
            onLockedPress={(v) => onLocked(lockOf(containers, v))}
            testIDPrefix="studio-export-container"
          />
          {!audio ? (
            <>
              <Label>{t('interface:contentStudio.export.videoCodec')}</Label>
              <Chips
                options={pickerChips(videos, tokenName)}
                value={out.videoCodec}
                onChange={(videoCodec) => setOutput({ videoCodec })}
                onLockedPress={(v) => onLocked(lockOf(videos, v))}
                testIDPrefix="studio-export-video"
              />
            </>
          ) : null}
          <Label>{t('interface:contentStudio.export.audioCodec')}</Label>
          <Chips
            options={pickerChips(audios, tokenName)}
            value={out.audioCodec}
            onChange={(audioCodec) => setOutput({ audioCodec })}
            onLockedPress={(v) => onLocked(lockOf(audios, v))}
            testIDPrefix="studio-export-audio"
          />
          {rates.length > 0 ? (
            <>
              <Label>{t('interface:contentStudio.export.audioBitrate')}</Label>
              <Chips
                options={rates.map((r) => ({
                  value: r,
                  label: t('interface:contentStudio.export.kbps', { value: r }),
                }))}
                value={out.audioBitrate}
                onChange={(audioBitrate) => setOutput({ audioBitrate })}
                testIDPrefix="studio-export-bitrate"
              />
            </>
          ) : null}
          <Label>{t('interface:contentStudio.export.audioChannels')}</Label>
          <Chips
            options={table.channels.map((n) => ({
              value: n,
              label:
                n === 1
                  ? t('interface:contentStudio.export.mono')
                  : t('interface:contentStudio.export.stereo'),
            }))}
            value={out.audioChannels}
            onChange={(audioChannels) => setOutput({ audioChannels })}
            testIDPrefix="studio-export-channels"
          />
        </>
      )}
      {lock ? (
        <Text className="text-sm text-subtle" testID="studio-export-locked">
          {t('darkroom.export.notOnPlan')}
        </Text>
      ) : null}
      {warnings.map((w) => (
        <Text key={w} className="text-sm text-subtle" testID={`studio-export-warning-${w}`}>
          {t(`interface:contentStudio.export.warning_${w}`, { defaultValue: '' })}
        </Text>
      ))}
      {!audio ? (
        <>
          <Label>{t('interface:contentStudio.export.resolution')}</Label>
          <Chips
            options={resOptions.map((o) => ({
              value: o.value,
              label:
                o.value === 0
                  ? t('interface:contentStudio.export.resolutionSource', { height: o.height })
                  : `${o.value}p`,
              locked: o.overCap,
            }))}
            value={c.resolution}
            onChange={(resolution) => set({ resolution })}
            testIDPrefix="studio-export-resolution"
          />
          {resOverCap ? (
            <Text className="text-sm text-subtle">{t('darkroom.export.notOnPlan')}</Text>
          ) : null}
        </>
      ) : null}
      <Label>{t('interface:contentStudio.export.quality')}</Label>
      <Chips
        options={QUALITIES.map((q) => ({
          value: q,
          label: t(`interface:contentStudio.export.${QUALITY_KEY[q]}`),
        }))}
        value={c.quality}
        onChange={(quality) => set({ quality })}
        testIDPrefix="studio-export-quality"
      />
      {!audio ? (
        <>
          <Label>{t('interface:contentStudio.export.captions')}</Label>
          {hasCaptions ? (
            <Chips
              options={captionsOptions}
              value={c.captionsMode}
              onChange={(captionsMode) => set({ captionsMode })}
              onLockedPress={() => onLocked(lockFor([EMBEDDED_SUBS_TOKEN], access))}
              testIDPrefix="studio-export-captions"
            />
          ) : (
            <Text className="text-sm text-subtle">
              {t('interface:contentStudio.export.captionsEmpty')}
            </Text>
          )}
        </>
      ) : null}
      <Label>{t('interface:contentStudio.export.loudness')}</Label>
      <Chips
        options={LOUDNESS.map((l) => ({
          value: l,
          label: t(`interface:contentStudio.export.${LOUDNESS_KEY[l]}`),
        }))}
        value={c.loudness}
        onChange={(loudness) => set({ loudness })}
        testIDPrefix="studio-export-loudness"
      />
      <Text className="text-sm text-subtle">{t('darkroom.export.savedVersion')}</Text>
      <Button
        testID="studio-export-start"
        label={t('interface:contentStudio.export.start')}
        disabled={lock !== null || resOverCap}
        onPress={() => onStart(c)}
      />
    </View>
  );
}

export function StudioExportSheet({
  project,
  onClose,
}: {
  project: StudioProjectSummary | null;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const visible = project !== null;
  const q = useGetStudioExportOptionsQuery(undefined, { skip: !visible });
  const me = useGetAccountMeQuery();
  const [shown, setShown] = useState<StudioProjectSummary | null>(project);
  // Keep the last project while the sheet animates out (render-time update, not an effect).
  if (project && project !== shown) setShown(project);
  const access = useMemo(() => (q.data ? accessOf(q.data) : null), [q.data]);

  const start = (c: ExportChoices) => {
    if (!q.data || !shown) return;
    const table = q.data.table;
    const out = choiceOutput(c, table);
    const file = containerFile(out.container, table);
    const localId = startStudioExportJob({
      options: {
        projectId: shown.id,
        body: buildExportRequest(c, table),
        timelineSeconds: shown.durationSeconds,
        props: exportProps(c, table, studioCaptionAnimation(shown)),
      },
      fileName: c.fileName.trim() || shown.name.trim() || 'export',
      ext: file.ext,
      mime: file.mime,
      audioOnly: isAudioOnlyContainer(out.container, table),
    });
    onClose();
    if (localId) router.push(`/(app)/job/${localId}` as Href);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerClassName="gap-3" testID="studio-export-sheet">
        <Text className="text-lg font-semibold">{t('interface:contentStudio.export.title')}</Text>
        {q.isLoading ? (
          <ActivityIndicator color={colors.primary} testID="studio-export-loading" />
        ) : q.isError || !q.data || !access || !shown ? (
          <View className="gap-3" testID="studio-export-options-error">
            <Text className="text-muted-fg">{t('darkroom.export.optionsFailed')}</Text>
            <Button label={t('history.retry')} variant="secondary" onPress={() => void q.refetch()} />
          </View>
        ) : (
          <ExportForm
            key={shown.id}
            table={q.data.table}
            access={access}
            project={shown}
            maxOutputHeight={me.data?.limits.maxOutputHeight}
            onStart={start}
          />
        )}
      </ScrollView>
    </Sheet>
  );
}
