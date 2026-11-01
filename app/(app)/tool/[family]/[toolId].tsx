import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { parseEntryPoint, trackToolViewed } from '@/analytics/toolEvents';
import { FileArea } from '@/files/components/FileArea';
import { getIntakeFiles } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { getJobEngine } from '@/jobs/runtime';
import { QuotaChip } from '@/quota/QuotaChip';
import { useAppDispatch } from '@/state/hooks';
import { toolOpened } from '@/state/slices/settings';
import { ToolIcon } from '@/tools/icons';
import { analyticsMediaKind, getTool } from '@/tools/registry';
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

  const start = useCallback(() => {
    if (files.length === 0) return;
    const ids = getJobEngine().startJobs(
      files.map((file) => ({ tool, file, options: tool.optionsBuilder(tool.defaults) })),
    );
    const first = ids[0];
    if (first) router.push(`/(app)/job/${first}`);
  }, [files, tool]);

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
        <Form value={tool.defaults} onChange={() => undefined} />
        <Button
          label={t('tool.start')}
          disabled={files.length === 0 || tool.endpoint === 'metadataInspect'}
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
