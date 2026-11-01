import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  Clock,
  Film,
  FileText,
  Image as ImageIcon,
  Music,
  TriangleAlert,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { HistoryEntry } from '@/api/schemas/history';
import { formatDateTime } from '@/lib/format';
import { getTool } from '@/tools/registry';
import { ToolIcon } from '@/tools/icons';
import { colors, hitTarget } from '@/ui/tokens';
import { Num, Text } from '@/ui/components/Text';
import { canKeepLonger, canReopen, deadlineOf, rowStatus } from './entryRules';
import { toolLabel } from './toolLabel';

const KIND_ICON: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
};

export interface HistoryRowProps {
  entry: HistoryEntry;
  onOpen(entry: HistoryEntry): void;
  onDelete(entry: HistoryEntry): void;
  onKeepLonger(entry: HistoryEntry): void;
  /** Long-press: the same actions in a sheet. */
  onMenu(entry: HistoryEntry): void;
  /** Result size when known (the list has no size field; reserved for a cached result). */
  sizeBytes?: number;
}

/** Hook: the row's visible title. */
export function useToolTitle(entry: HistoryEntry): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const l = toolLabel(entry);
    return l.key ? t(l.key) : (l.text ?? '');
  }, [entry, t]);
}

function SwipeAction({
  label,
  tone,
  onPress,
  testID,
}: {
  label: string;
  tone: 'danger' | 'neutral';
  onPress(): void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      className={`items-center justify-center px-4 ${tone === 'danger' ? 'bg-danger' : 'bg-surface-3'}`}
      style={{ minWidth: 88, minHeight: hitTarget }}
    >
      <Text className={`text-sm font-semibold ${tone === 'danger' ? 'text-on-primary' : ''}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One server history row (TOOLS_V1 §7): icon, tool label, `SRC -> DST`, status chip and the deadline.
 * Swipe toward the logical end edge for Delete and Keep longer (the library mirrors the actions in RTL);
 * TalkBack gets the same through `accessibilityActions`.
 */
export function HistoryRow({ entry, onOpen, onDelete, onKeepLonger, onMenu }: HistoryRowProps) {
  const { t } = useTranslation();
  const title = useToolTitle(entry);
  const label = toolLabel(entry);
  const registry = label.toolId ? getTool(label.toolId) : undefined;
  const KindIcon = KIND_ICON[entry.mediaKind ?? ''] ?? FileText;
  const open = canReopen(entry);
  const keep = canKeepLonger(entry);
  const status = rowStatus(entry);
  const deadline = deadlineOf(entry);
  const formats =
    entry.sourceFormat && entry.targetFormat
      ? `${entry.sourceFormat.toUpperCase()} → ${entry.targetFormat.toUpperCase()}`
      : (entry.targetFormat ?? entry.sourceFormat ?? '').toUpperCase();

  const actions = [
    { name: 'delete', label: t('history.actions.delete') },
    ...(keep ? [{ name: 'keep', label: t('history.actions.keepLonger') }] : []),
  ];

  const body = (
    <Pressable
      testID={`history-row-${entry.jobId}`}
      onPress={() => open && onOpen(entry)}
      onLongPress={() => onMenu(entry)}
      accessibilityRole={open ? 'button' : undefined}
      accessibilityState={{ disabled: !open }}
      accessibilityActions={actions}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'delete') onDelete(entry);
        else if (e.nativeEvent.actionName === 'keep') onKeepLonger(entry);
      }}
      className={`flex-row items-center gap-3 bg-surface-0 px-4 py-3 ${entry.expired ? 'opacity-50' : ''}`}
      style={{ minHeight: hitTarget }}
    >
      {registry ? (
        <ToolIcon name={registry.icon} size={22} color={colors.mutedFg} />
      ) : (
        <KindIcon size={22} color={colors.mutedFg} />
      )}
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold" numberOfLines={1}>
          {title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-x-2">
          {formats ? <Num className="text-xs text-muted-fg">{formats}</Num> : null}
          {status ? (
            <View className="flex-row items-center gap-1">
              {status === 'failed' ? (
                <TriangleAlert size={12} color={colors.danger} />
              ) : (
                <Clock size={12} color={colors.data} />
              )}
              <Text
                className={`text-xs ${status === 'failed' ? 'text-danger' : 'text-muted-fg'}`}
                testID={`history-status-${entry.jobId}`}
              >
                {t(`history.status.${status}`)}
              </Text>
            </View>
          ) : null}
        </View>
        {entry.expired ? (
          <Text className="text-xs text-subtle">{t('history.expired')}</Text>
        ) : deadline && status === null ? (
          <Num className="text-xs text-subtle">
            {t('history.deletesOn', { date: formatDateTime(deadline, 'date') })}
          </Num>
        ) : null}
      </View>
      {entry.keptLonger && !entry.expired ? (
        <View className="rounded-sm border border-edge px-2 py-0.5">
          <Text className="text-xs text-data">{t('history.keptLonger')}</Text>
        </View>
      ) : null}
    </Pressable>
  );

  if (entry.expired) return body;
  // The logical end edge is the physical right in LTR and the left in RTL; the library only knows physical sides.
  const renderEnd = (_p: unknown, _t: unknown, methods: { close(): void }) => (
    <View className="flex-row">
      {keep ? (
        <SwipeAction
          testID={`history-keep-${entry.jobId}`}
          tone="neutral"
          label={t('history.actions.keepLonger')}
          onPress={() => {
            methods.close();
            onKeepLonger(entry);
          }}
        />
      ) : null}
      <SwipeAction
        testID={`history-delete-${entry.jobId}`}
        tone="danger"
        label={t('history.actions.delete')}
        onPress={() => {
          methods.close();
          onDelete(entry);
        }}
      />
    </View>
  );
  const endProps = I18nManager.isRTL
    ? { renderLeftActions: renderEnd }
    : { renderRightActions: renderEnd };
  return (
    <ReanimatedSwipeable friction={2} overshootRight={false} overshootLeft={false} {...endProps}>
      {body}
    </ReanimatedSwipeable>
  );
}

// i18n-keys: history.status.processing, history.status.failed
