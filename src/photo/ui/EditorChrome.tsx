/** The editor chrome (top bar, tool strip, sheet bodies): no router import, so tests render it. */
import { Redo2, Undo2, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { showNotice } from '@/ui/notice';
import { colors, hitTarget } from '@/ui/tokens';
import type { Histogram64 } from '../histogram';
import { photoActions, selectCanRedo, selectCanUndo } from '../photoStore';
import type { UploadStatus } from '../session';
import { useEditor as useEditorStore, usePhotoSelector } from './EditorContext';
import { BasicSheet } from './sheets/BasicSheet';
import { BlackWhiteSheet } from './sheets/BlackWhiteSheet';
import { ColorSheet } from './sheets/ColorSheet';
import { CurvesSheet } from './sheets/CurvesSheet';
import { LayersSheet } from './sheets/LayersSheet';
import { LevelsSheet } from './sheets/LevelsSheet';
import { MoreSheet } from './sheets/MoreSheet';

export const STRIP = ['basic', 'color', 'curves', 'levels', 'bw', 'more', 'layers'] as const;
export type StripTool = (typeof STRIP)[number];

export function TopBar({
  name,
  upload,
  onBack,
  onSave,
  onExport,
  saving,
}: {
  name: string;
  upload: UploadStatus;
  onBack: () => void;
  onSave: () => void;
  onExport: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const canUndo = usePhotoSelector(selectCanUndo);
  const canRedo = usePhotoSelector(selectCanRedo);
  const dirty = usePhotoSelector((s) => s.dirty);
  const projectId = usePhotoSelector((s) => s.projectId);
  const { store } = useEditorStore();
  const icon = (
    Icon: typeof X,
    label: string,
    onPress: () => void,
    disabled = false,
    testID?: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: hitTarget,
        height: hitTarget,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon size={22} color={colors.foreground} />
    </Pressable>
  );
  return (
    <View style={{ paddingTop: insets.top }} className="border-b border-edge bg-surface-1">
      <View className="flex-row items-center gap-1 px-2" style={{ minHeight: hitTarget }}>
        {icon(X, t('common.back'), onBack, false, 'photo-back')}
        <Text className="flex-1 font-semibold" numberOfLines={1}>
          {name || t('interface:photo.untitled')}
        </Text>
        {icon(
          Undo2,
          t('interface:photo.bar.undo'),
          () => store.dispatch(photoActions.undone()),
          !canUndo,
          'photo-undo',
        )}
        {icon(
          Redo2,
          t('interface:photo.bar.redo'),
          () => store.dispatch(photoActions.redone()),
          !canRedo,
          'photo-redo',
        )}
        <Button
          testID="photo-save"
          variant="secondary"
          label={t('interface:photo.bar.save')}
          disabled={!projectId || !dirty}
          loading={saving}
          onPress={onSave}
        />
        <Button testID="photo-export" label={t('interface:photo.bar.export')} onPress={onExport} />
      </View>
      {upload.kind === 'uploading' ? (
        <View className="px-4 pb-2">
          <Text testID="photo-upload-chip" className="text-sm text-data">
            {t('photo.uploading', { percent: Math.round(upload.fraction * 100) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function ToolStrip({
  active,
  onPick,
}: {
  active: StripTool | null;
  onPick: (t: StripTool) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingBottom: insets.bottom }} className="border-t border-edge bg-surface-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-1 px-2"
      >
        {STRIP.map((k) => (
          <Pressable
            key={k}
            testID={`photo-strip-${k}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active === k }}
            onPress={() => onPick(k)}
            className={`items-center justify-center rounded-md px-3 ${active === k ? 'bg-surface-3' : ''}`}
            style={{ minHeight: hitTarget + 8 }}
          >
            <Text className={active === k ? 'font-semibold' : 'text-muted-fg'}>
              {t(`photo.strip.${k}`)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function SheetBody({ tool, histogram }: { tool: StripTool; histogram: Histogram64 | null }) {
  const { t } = useTranslation();
  switch (tool) {
    case 'basic':
      return <BasicSheet />;
    case 'color':
      return <ColorSheet />;
    case 'curves':
      return <CurvesSheet onRefused={() => showNotice(t('photo.curves.refused'))} />;
    case 'levels':
      return <LevelsSheet histogram={histogram} />;
    case 'bw':
      return <BlackWhiteSheet />;
    case 'more':
      return <MoreSheet />;
    case 'layers':
      return <LayersSheet />;
  }
}
