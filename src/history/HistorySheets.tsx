import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { canKeepLonger, KEEP_OPTIONS } from './entryRules';
import { useToolTitle } from './HistoryRow';
import type { HistorySheet } from './useHistoryActions';

/** Long-press menu, keep-longer picker and delete confirm (one `Sheet`). */
export function HistorySheets({
  sheet,
  onClose,
  onSheet,
  onDelete,
  onKeep,
}: {
  sheet: HistorySheet | null;
  onClose(): void;
  onSheet(next: HistorySheet): void;
  onDelete(entry: HistorySheet['entry']): void;
  onKeep(entry: HistorySheet['entry'], hours: number): void;
}) {
  const { t } = useTranslation();
  const title = useToolTitle(
    sheet?.entry ?? { jobId: '', status: '', createdAt: '', expired: false },
  );
  return (
    <Sheet visible={sheet !== null} onClose={onClose}>
      {sheet?.kind === 'menu' ? (
        <View className="gap-2" testID="history-menu">
          <Text className="mb-1 text-base font-semibold">
            {t('history.actions.title', { name: title })}
          </Text>
          {canKeepLonger(sheet.entry) ? (
            <Button
              variant="secondary"
              label={t('history.actions.keepLonger')}
              onPress={() => onSheet({ kind: 'keep', entry: sheet.entry })}
              testID="menu-keep"
            />
          ) : null}
          <Button
            variant="ghost"
            label={t('history.actions.delete')}
            onPress={() => onSheet({ kind: 'delete', entry: sheet.entry })}
            testID="menu-delete"
          />
        </View>
      ) : null}
      {sheet?.kind === 'keep' ? (
        <View className="gap-2" testID="history-keep-sheet">
          <Text className="mb-1 text-base font-semibold">{t('history.keep.title')}</Text>
          {KEEP_OPTIONS.map((o) => (
            <Button
              key={o.id}
              variant="secondary"
              label={t(`history.keep.${o.id}`)}
              onPress={() => onKeep(sheet.entry, o.hours)}
              testID={`keep-${o.id}`}
            />
          ))}
        </View>
      ) : null}
      {sheet?.kind === 'delete' ? (
        <View className="gap-2" testID="history-delete-sheet">
          <Text className="text-base font-semibold">{t('delete.title')}</Text>
          <Text className="text-muted-fg">{t('delete.body')}</Text>
          <Button
            variant="danger"
            label={t('delete.confirm')}
            onPress={() => onDelete(sheet.entry)}
            testID="confirm-delete"
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
        </View>
      ) : null}
    </Sheet>
  );
}

// i18n-keys: history.keep.week, history.keep.month, history.keep.sixMonths, history.keep.year
