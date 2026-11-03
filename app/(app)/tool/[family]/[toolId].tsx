import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { EVENTS } from '@/analytics/events';
import { setContext, track } from '@/analytics/track';
import { parseEntryPoint, trackToolViewed } from '@/analytics/toolEvents';
import { FileArea } from '@/files/components/FileArea';
import { getIntakeFiles } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { getJobEngine } from '@/jobs/runtime';
import { QuotaChip } from '@/quota/QuotaChip';
import { useAccountLimitsFull } from '@/quota/useAccountLimitsFull';
import { useAppDispatch } from '@/state/hooks';
import { toolOpened } from '@/state/slices/settings';
import { ToolIcon } from '@/tools/icons';
import { analyticsMediaKind, getTool, type ToolContext, type ToolOptions } from '@/tools/registry';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';

const TOOLS_TAB = '/(app)/(tabs)';

const OPTIONS_DEBOUNCE_MS = 600;

function ToolScreen({
  toolId,
  from,
  intake,
  preset,
}: {
  toolId: string;
  from?: string;
  intake?: string;
  preset?: string;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tool = getTool(toolId)!;
  const attached = useMemo(() => getIntakeFiles(intake ? intake.split(',') : []), [intake]);
  const [files, setFiles] = useState<IntakeFile[]>(attached);
  // Start hands the cached copies to their jobs (the engine moves or deletes them when the job ends),
  // so the screen lets go of them: Back then Start again must not upload a file that is gone.
  const [consumed, setConsumed] = useState(0);

  const [form, setForm] = useState<ToolOptions>(() => ({
    ...tool.defaults,
    ...(tool.presets?.find((p) => p.id === preset)?.defaults ?? {}),
  }));
  const limits = useAccountLimitsFull();
  const first = files[0];
  const ctx = useMemo<ToolContext>(
    () => ({
      input: first
        ? {
            id: first.id,
            sizeBytes: first.sizeBytes,
            name: first.name,
            uri: first.uri,
            extension: first.extension,
            mime: first.mimeType,
            mediaKind: first.mediaKind,
            width: first.width,
            height: first.height,
            durationSec: first.durationSec,
          }
        : undefined,
      limits: limits ? { maxOutputHeight: limits.maxOutputHeight } : undefined,
    }),
    [first, limits],
  );

  // options_changed: keys only, debounced per option (web precedent: sliders are high volume).
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((h) => clearTimeout(h));
  }, []);
  const onFormChange = useCallback((next: ToolOptions) => {
    setForm((prev) => {
      for (const key of Object.keys(next)) {
        if (JSON.stringify(prev[key]) === JSON.stringify(next[key])) continue;
        clearTimeout(timers.current.get(key));
        timers.current.set(
          key,
          setTimeout(() => {
            timers.current.delete(key);
            track(EVENTS.OPTIONS_CHANGED, { option: key });
          }, OPTIONS_DEBOUNCE_MS),
        );
      }
      return next;
    });
  }, []);

  const blocked = tool.blockReason?.(form, ctx) ?? null;
  const slug = tool.analyticsSlugFor ? tool.analyticsSlugFor(form, ctx) : tool.analyticsSlug;
  useEffect(() => {
    setContext({ tool_slug: slug });
  }, [slug]);

  const [starting, setStarting] = useState(false);
  const start = useCallback(async () => {
    if (files.length === 0 || blocked) return;
    setStarting(true);
    try {
      // MA20: a tool may need an async step first (face re-detect when its session expired).
      const ready = tool.prepare ? await tool.prepare(form, ctx) : form;
      const runTool = {
        ...tool,
        analyticsSlug: tool.analyticsSlugFor
          ? tool.analyticsSlugFor(ready, ctx)
          : tool.analyticsSlug,
      };
      const ids = getJobEngine().startJobs(
        files.map((file) => ({ tool: runTool, file, options: tool.optionsBuilder(ready, ctx) })),
      );
      const firstId = ids[0];
      setFiles([]);
      setConsumed((n) => n + 1);
      if (firstId) router.push(`/(app)/job/${firstId}`);
    } finally {
      setStarting(false);
    }
  }, [files, tool, form, ctx, blocked]);

  useEffect(() => {
    dispatch(toolOpened(tool.id));
    return trackToolViewed(tool, analyticsMediaKind(tool), parseEntryPoint(from));
    // Fires once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id]);

  const kinds = tool.accepts.kinds.map((k) => t(`tool.kinds.${k}`)).join(' · ');
  const { Form } = tool;
  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="flex-row items-center gap-3">
          <ToolIcon name={tool.icon} size={28} color={colors.data} />
          <Text className="flex-1 text-xl font-semibold">{t(tool.titleKey)}</Text>
        </View>
        <Text className="text-muted-fg">{t(tool.descriptionKey)}</Text>
        <Text className="text-sm text-subtle">{t('tool.accepts', { kinds })}</Text>
        <QuotaChip metric={tool.metric} />
        <FileArea
          key={consumed}
          tool={tool}
          initialFiles={consumed ? [] : attached}
          onFilesChange={setFiles}
        />
        <Form value={form} onChange={onFormChange} ctx={ctx} />
        {tool.noRunButton ? null : (
          <Button
            label={t(tool.startLabelKey ?? 'tool.start')}
            disabled={files.length === 0 || blocked !== null}
            loading={starting}
            onPress={() => void start()}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

// i18n-keys: tool.kinds.image, tool.kinds.video, tool.kinds.audio, tool.kinds.pdf, tools.metadata.strip.stripEverything, tools.metadata.edit.apply
export default function ToolRoute() {
  const { family, toolId, from, intake, preset } = useLocalSearchParams<{
    family: string;
    toolId: string;
    from?: string;
    intake?: string;
    preset?: string;
  }>();
  const tool = typeof toolId === 'string' ? getTool(toolId) : undefined;
  if (!tool || tool.family !== family) return <Redirect href={TOOLS_TAB} />;
  return (
    <ToolScreen
      // One screen instance per tool (and preset): a deep link from one tool to another reuses this
      // route, and without a key the previous tool's form state leaked in (S25: Extract audio opened
      // with Video to GIF's options and no format selected).
      key={`${tool.id}:${typeof preset === 'string' ? preset : ''}`}
      toolId={tool.id}
      from={typeof from === 'string' ? from : undefined}
      intake={typeof intake === 'string' ? intake : undefined}
      preset={typeof preset === 'string' ? preset : undefined}
    />
  );
}
