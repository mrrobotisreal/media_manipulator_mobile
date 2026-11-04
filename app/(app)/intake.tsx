import { Redirect, useRouter, type Href } from 'expo-router';
import { ChevronRight, FileQuestion } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, ScrollView, View } from 'react-native';
import { FileCard, RejectionCard } from '@/files/components/FileCard';
import { toolsForKinds } from '@/files/intakeTools';
import { useToolAvailability } from '@/tools/availability';
import { getIntakeBatch } from '@/files/session';
import type { IntakeFile, Rejection } from '@/files/types';
import { useAppSelector } from '@/state/hooks';
import { ToolIcon } from '@/tools/icons';
import type { AnyToolDefinition } from '@/tools/types';
import { EmptyState } from '@/ui/components/EmptyState';
import { Screen } from '@/ui/components/Screen';
import { Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';

const TOOLS_TAB = '/(app)/(tabs)' as Href;

const NONE_FILES: IntakeFile[] = [];
const NONE_REJECTED: Rejection[] = [];

export default function IntakeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const lastToolIds = useAppSelector((s) => s.settings.lastToolIds);
  const batch = getIntakeBatch();
  const files = batch?.files ?? NONE_FILES;
  const rejected = batch?.rejected ?? NONE_REJECTED;

  const kinds = files.map((f) => f.mediaKind);
  const available = useToolAvailability();
  const tools = toolsForKinds(kinds, lastToolIds).filter(available);
  // Inspect metadata accepts every kind, so the intersection is never empty; still say why the list is short.
  const mixed = new Set(kinds).size > 1;
  const back = () => router.replace(TOOLS_TAB);

  // Opened without a pending share (stale deep link, process restart): nothing to show.
  if (!batch) return <Redirect href={TOOLS_TAB} />;

  if (files.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={FileQuestion}
          title={t('intake.unsupported.title')}
          body={t('intake.unsupported.body')}
          actionLabel={t('intake.unsupported.back')}
          onAction={back}
        />
        {rejected.length > 0 ? (
          <ScrollView contentContainerClassName="gap-3 p-4">
            {rejected.map((r) => (
              <RejectionCard key={r.id} rejection={r} />
            ))}
          </ScrollView>
        ) : null}
      </Screen>
    );
  }

  const open = (tool: AnyToolDefinition) =>
    router.push(
      `/(app)/tool/${tool.family}/${tool.id}?from=intake&intake=${files.map((f) => f.id).join(',')}` as Href,
    );

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-3 p-4">
        <Text className="text-xl font-semibold">{t('intake.title')}</Text>
        {files.map((f) => (
          <FileCard key={f.id} file={f} />
        ))}
        {rejected.map((r) => (
          <RejectionCard key={r.id} rejection={r} />
        ))}
        <Text className="mt-2 text-sm font-semibold uppercase text-muted-fg">
          {files.length > 1
            ? t('intake.toolsForMany', { count: files.length })
            : t('intake.toolsFor')}
        </Text>
        {mixed || tools.length === 0 ? (
          <Text className="text-muted-fg">{t('intake.mixedKinds')}</Text>
        ) : null}
        {tools.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            onPress={() => open(tool)}
            className="flex-row items-center gap-3 rounded-lg border border-edge bg-surface-1 px-3 py-2"
            style={{ minHeight: hitTarget }}
          >
            <ToolIcon name={tool.icon} size={22} color={colors.data} />
            <Text className="flex-1 font-semibold" numberOfLines={1}>
              {t(tool.titleKey)}
            </Text>
            <ChevronRight
              size={18}
              color={colors.subtle}
              style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
            />
          </Pressable>
        ))}
        <View className="h-4" />
      </ScrollView>
    </Screen>
  );
}
