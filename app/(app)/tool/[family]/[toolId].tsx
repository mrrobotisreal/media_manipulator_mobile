import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { parseEntryPoint, trackToolViewed } from '@/analytics/toolEvents';
import { setContext } from '@/analytics/track';
import { FileArea } from '@/files/components/FileArea';
import { getIntakeFiles } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { getJobEngine } from '@/jobs/runtime';
import { QuotaChip } from '@/quota/QuotaChip';
import { useAccountLimitsFull } from '@/quota/useAccountLimitsFull';
import { useAppDispatch } from '@/state/hooks';
import { toolOpened } from '@/state/slices/settings';
import { ToolIcon } from '@/tools/icons';
import { createOptionsChangedReporter } from '@/tools/optionsChanged';
import { analyticsMediaKind, getTool } from '@/tools/registry';
import type { ToolBuildContext, ToolFileInfo, ToolOptions } from '@/tools/types';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';

const TOOLS_TAB = '/(app)/(tabs)';

function ToolScreen({ toolId, from, intake }: { toolId: string; from?: string; intake?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tool = getTool(toolId)!;
  const attached = useMemo(() => getIntakeFiles(intake ? intake.split(',') : []), [intake]);
  const [files, setFiles] = useState<IntakeFile[]>(attached);

  const limits = useAccountLimitsFull();
  const [form, setForm] = useState<ToolOptions>(tool.defaults);
  const [reporter] = useState(() => createOptionsChangedReporter());
  const first = files[0];
  const fileInfo: ToolFileInfo | undefined = first
    ? {
        extension: first.extension,
        durationSec: first.durationSec,
        width: first.width,
        height: first.height,
        uri: first.uri,
      }
    : undefined;
  const ctx: ToolBuildContext = useMemo(
    () => ({ file: fileInfo, limits: { maxOutputHeight: limits?.maxOutputHeight } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [first?.id, first?.durationSec, limits?.maxOutputHeight],
  );
  const valid = tool.isValid ? tool.isValid(form, ctx) : true;
  const slug = tool.analyticsSlugFor ? tool.analyticsSlugFor(form) : tool.analyticsSlug;

  // A different first file starts from the tool defaults (ranges and crops belong to one clip).
  const firstId = first?.id;
  const [formFor, setFormFor] = useState(firstId);
  if (formFor !== firstId) {
    setFormFor(firstId);
    setForm(tool.defaults);
  }

  useEffect(() => {
    setContext({ tool_slug: slug });
  }, [slug]);
  useEffect(() => () => reporter.flush(), [reporter]);

  const onFormChange = (next: ToolOptions) => {
    reporter.note(form, next);
    setForm(next);
  };

  const start = useCallback(() => {
    if (files.length === 0 || !valid) return;
    const runTool = { ...tool, analyticsSlug: slug };
    const options = tool.optionsBuilder(form, ctx);
    const ids = getJobEngine().startJobs(files.map((file) => ({ tool: runTool, file, options })));
    const firstId = ids[0];
    if (firstId) router.push(`/(app)/job/${firstId}`);
  }, [files, tool, form, ctx, valid, slug]);

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
        <FileArea tool={tool} initialFiles={attached} onFilesChange={setFiles} />
        <Form value={form} onChange={onFormChange} file={fileInfo} limits={ctx.limits} />
        <Button
          label={t('tool.start')}
          disabled={files.length === 0 || !valid || tool.endpoint === 'metadataInspect'}
          onPress={start}
        />
      </ScrollView>
    </Screen>
  );
}

// i18n-keys: tool.kinds.image, tool.kinds.video, tool.kinds.audio, tool.kinds.pdf
export default function ToolRoute() {
  const { family, toolId, from, intake } = useLocalSearchParams<{
    family: string;
    toolId: string;
    from?: string;
    intake?: string;
  }>();
  const tool = typeof toolId === 'string' ? getTool(toolId) : undefined;
  if (!tool || tool.family !== family) return <Redirect href={TOOLS_TAB} />;
  return (
    <ToolScreen
      toolId={tool.id}
      from={typeof from === 'string' ? from : undefined}
      intake={typeof intake === 'string' ? intake : undefined}
    />
  );
}
