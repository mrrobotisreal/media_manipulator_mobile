import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { Sheet } from '@/ui/components/Sheet';
import { ProgressBar } from '@/ui/components/ProgressBar';
import type { useResultActions } from './useResultActions';

export type ResultActions = ReturnType<typeof useResultActions>;

export interface ActionsBarProps {
  actions: ResultActions;
  /** Share link offered (`isShareable`). */
  canShareLink: boolean;
  /** MP3 offered (`canOfferMp3`). */
  canMp3: boolean;
  /** Run another offered (a registry tool is known). */
  canRunAnother: boolean;
  /** Haptics preference. */
  haptics?: boolean;
}

function MoreSheet({ actions, canShareLink, canMp3, canRunAnother }: ActionsBarProps) {
  const { t } = useTranslation();
  return (
    <View className="gap-2" testID="more-sheet">
      <Text className="mb-1 text-base font-semibold">{t('actions.moreTitle')}</Text>
      {canShareLink ? (
        <Button
          variant="secondary"
          label={t('actions.shareLink')}
          onPress={actions.copyShareLink}
          testID="action-share-link"
        />
      ) : null}
      {canMp3 ? (
        <Button
          variant="secondary"
          label={t('actions.downloadMp3')}
          onPress={actions.downloadMp3}
          testID="action-mp3"
        />
      ) : null}
      {canRunAnother ? (
        <Button
          variant="secondary"
          label={t('actions.runAnother')}
          onPress={actions.runAnother}
          testID="action-run-another"
        />
      ) : null}
      <Button
        variant="ghost"
        label={t('actions.delete')}
        onPress={() => actions.setSheet('delete')}
        testID="action-delete"
      />
    </View>
  );
}

/**
 * Result actions (MA14 decision 2): Save (primary) · Share · More. Logical layout only, so the row
 * mirrors under RTL. While a download or conversion runs the bar shows its progress and the buttons
 * are disabled.
 */
export function ActionsBar(props: ActionsBarProps) {
  const { t } = useTranslation();
  const { actions, haptics } = props;
  const pct = actions.progress !== null ? Math.round(actions.progress * 100) : 0;
  return (
    <View className="gap-3" testID="actions-bar">
      {actions.converting ? (
        <View className="gap-2" testID="mp3-converting">
          <ProgressBar />
          <Text className="text-sm text-muted-fg">{t('mp3.converting')}</Text>
        </View>
      ) : actions.progress !== null ? (
        <View className="gap-2" testID="download-progress">
          <ProgressBar value={actions.progress} accent="data" />
          <Num className="text-sm text-muted-fg">
            {t('download.progress', { percent: `${pct}%` })}
          </Num>
        </View>
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label={t('actions.save')}
            haptics={haptics}
            loading={actions.working}
            onPress={() => void actions.save()}
            testID="action-save"
          />
        </View>
        <View className="flex-1">
          <Button
            variant="secondary"
            label={t('actions.share')}
            haptics={haptics}
            disabled={actions.working}
            onPress={() => void actions.share()}
            testID="action-share"
          />
        </View>
        <View className="flex-1">
          <Button
            variant="secondary"
            label={t('actions.more')}
            disabled={actions.working}
            onPress={() => actions.setSheet('more')}
            testID="action-more"
          />
        </View>
      </View>

      <Sheet visible={actions.sheet === 'more'} onClose={() => actions.setSheet(null)}>
        <MoreSheet {...props} />
      </Sheet>

      <Sheet visible={actions.sheet === 'permission'} onClose={() => actions.setSheet(null)}>
        <View className="gap-3" testID="permission-sheet">
          <Text className="text-base font-semibold">{t('save.permissionTitle')}</Text>
          <Text className="text-muted-fg">{t('save.permissionBody')}</Text>
          <Button label={t('save.openSettings')} onPress={actions.openSettings} />
          <Button
            variant="secondary"
            label={t('save.filesInstead')}
            onPress={actions.saveToFilesInstead}
            testID="action-files-instead"
          />
        </View>
      </Sheet>

      <Sheet visible={actions.sheet === 'limit'} onClose={() => actions.setSheet(null)}>
        <View className="gap-3" testID="limit-sheet">
          <Text className="text-base font-semibold">{t('interface:share.limitTitle')}</Text>
          <Text className="text-muted-fg">{t('interface:share.limitBody')}</Text>
          <Button
            label={t('interface:share.revokeConfirm')}
            onPress={actions.revokeLinks}
            testID="action-revoke"
          />
          <Button
            variant="ghost"
            label={t('interface:share.cancel')}
            onPress={() => actions.setSheet(null)}
          />
        </View>
      </Sheet>

      <Sheet visible={actions.sheet === 'delete'} onClose={() => actions.setSheet(null)}>
        <View className="gap-3" testID="delete-sheet">
          <Text className="text-base font-semibold">{t('delete.title')}</Text>
          <Text className="text-muted-fg">{t('delete.body')}</Text>
          <Button
            variant="danger"
            label={t('delete.confirm')}
            onPress={actions.remove}
            testID="action-delete-confirm"
          />
          <Button
            variant="ghost"
            label={t('common.cancel')}
            onPress={() => actions.setSheet(null)}
          />
        </View>
      </Sheet>
    </View>
  );
}
