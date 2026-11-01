import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { parseEntryPoint, trackToolViewed } from '@/analytics/toolEvents';
import { useAppDispatch } from '@/state/hooks';
import { toolOpened } from '@/state/slices/settings';
import { QuotaHeaderSlot } from '@/tools/components/QuotaHeaderSlot';
import { ToolIcon } from '@/tools/icons';
import { analyticsMediaKind, getTool } from '@/tools/registry';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';

const TOOLS_TAB = '/(app)/(tabs)';

function ToolScreen({ toolId, from }: { toolId: string; from?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tool = getTool(toolId)!;

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
        <QuotaHeaderSlot />
        <View className="h-28 items-center justify-center rounded-lg border border-dashed border-edge-control">
          <Text className="text-muted-fg">{t('tool.fileArea')}</Text>
        </View>
        <Form value={tool.defaults} onChange={() => undefined} />
        <Button label={t('tool.start')} disabled />
      </ScrollView>
    </Screen>
  );
}

// i18n-keys: tool.kinds.image, tool.kinds.video, tool.kinds.audio, tool.kinds.pdf
export default function ToolRoute() {
  const { family, toolId, from } = useLocalSearchParams<{
    family: string;
    toolId: string;
    from?: string;
  }>();
  const tool = typeof toolId === 'string' ? getTool(toolId) : undefined;
  if (!tool || tool.family !== family) return <Redirect href={TOOLS_TAB} />;
  return <ToolScreen toolId={tool.id} from={typeof from === 'string' ? from : undefined} />;
}
