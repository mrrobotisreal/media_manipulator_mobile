/**
 * Presets (ticket MA51 decision 8; MA53 decisions 2-4; web `panels/presets-panel.tsx`): a horizontal
 * strip of the built-in looks with live 96 px thumbnails (the photo through the preset, rendered by
 * the editor on a 256 px downscale and cached per source), Auto (computed from the preview's
 * histogram), and "My presets" on the account (MM103 `photo_presets`, `../../presetsApi.ts`): save
 * the current stack, rename (`If-Match`), delete, export as JSON through the share sheet, import a
 * JSON file (uploaded up to the plan's cap). Rows show the server thumbnail when there is one, else a
 * local render. Applying appends the look as ONE group ("Preset: <name>"); Undo removes it.
 *
 * MA51's device presets (MMKV `photoPresets`) are only a migration source now (`migration.ts`): the
 * first open with an empty account and device presets offers to keep them on the account; after a
 * "not now" (or when the account already has presets) each one gets its own Upload.
 * A 403 `photo_presets_limit` opens the MA16 limit sheet with the neutral cap line (MA-0008); no
 * connection shows "You're offline; try again" (no preset outbox exists to queue into).
 */
import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import type { MmError } from '@/api/errors';
import { buildHeaders } from '@/api/baseQuery';
import { mmkvStorage } from '@/state/persist';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { showNotice } from '@/ui/notice';
import { colors } from '@/ui/tokens';
import { presetLabel } from '../../history';
import type { AdjustmentLayer } from '../../photoTypes';
import {
  applyPreset,
  BUILTIN_PRESETS,
  builtinLayers,
  exportPresetsJson,
  listUserPresets,
  presetLayersOf,
  type KvStorage,
  type UserPreset,
} from '../../presets/presetStore';
import {
  migrateLocalPresets,
  migrationDeclined,
  setMigrationDeclined,
  shouldOfferMigration,
  uploadLocalPreset,
  type CreateAccountPreset,
} from '../../presets/migration';
import { parseUserPresetsJson, USER_PRESET_NAME_MAX } from '../../presets/userStore';
import {
  asUserPreset,
  isOfflineError,
  presetConflictRevision,
  presetThumbnailUri,
  useCreatePhotoPresetMutation,
  useDeletePhotoPresetMutation,
  useListPhotoPresetsQuery,
  useUpdatePhotoPresetMutation,
  useUploadPhotoPresetThumbnailMutation,
  type AccountPreset,
} from '../../presetsApi';
import { useEdit, useEditorTools, usePhotoSelector } from '../EditorContext';

export const PRESET_THUMB = 96;
const ROW_THUMB = 48;
const kvDefault = mmkvStorage as unknown as KvStorage;

function Thumb({ image, label }: { image: SkImage | null; label: string }) {
  return (
    <View style={{ width: PRESET_THUMB }} className="gap-1">
      <View
        style={{
          width: PRESET_THUMB,
          height: PRESET_THUMB,
          direction: 'ltr',
          backgroundColor: colors.surface2,
        }}
        className="overflow-hidden rounded-md"
      >
        {image ? (
          <Canvas style={{ width: PRESET_THUMB, height: PRESET_THUMB }}>
            <SkiaImage
              image={image}
              x={0}
              y={0}
              width={PRESET_THUMB}
              height={PRESET_THUMB}
              fit="cover"
            />
          </Canvas>
        ) : null}
      </View>
      <Text className="text-xs" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function useAuthHeaders(): Record<string, string> | null {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    void buildHeaders().then((h) => live && setHeaders(h));
    return () => {
      live = false;
    };
  }, []);
  return headers;
}

/** A row's 48 px thumbnail: the server PNG when the preset has one, else the photo through it. */
function RowThumb({
  preset,
  headers,
  local,
}: {
  preset: { id: string; hasThumbnail?: boolean; updatedAt?: string };
  headers: Record<string, string> | null;
  local: SkImage | null;
}) {
  return (
    <View
      style={{
        width: ROW_THUMB,
        height: ROW_THUMB,
        direction: 'ltr',
        backgroundColor: colors.surface2,
      }}
      className="overflow-hidden rounded-md"
    >
      {preset.hasThumbnail && headers ? (
        <Image
          testID={`photo-preset-thumb-server-${preset.id}`}
          source={{ uri: presetThumbnailUri(preset.id), headers }}
          style={{ width: ROW_THUMB, height: ROW_THUMB }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${preset.id}:${preset.updatedAt ?? ''}`}
          accessibilityIgnoresInvertColors
        />
      ) : local ? (
        <Canvas style={{ width: ROW_THUMB, height: ROW_THUMB }}>
          <SkiaImage image={local} x={0} y={0} width={ROW_THUMB} height={ROW_THUMB} fit="cover" />
        </Canvas>
      ) : null}
    </View>
  );
}

/** "Keep your {{count}} presets on your account?" (MA53 decision 3). */
export function PresetMigrationSheet({
  visible,
  count,
  busy,
  onKeep,
  onNotNow,
  onClose,
}: {
  visible: boolean;
  count: number;
  busy: boolean;
  onKeep(): void;
  onNotNow(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose}>
      <View className="gap-3" testID="photo-preset-migrate">
        <Text className="text-lg font-semibold">
          {t('interface:photo.presets.migrate.prompt', { count })}
        </Text>
        <Text className="text-muted-fg">{t('photo.presets.migrate.body')}</Text>
        <Button
          testID="photo-preset-migrate-keep"
          label={t('interface:photo.presets.migrate.accept')}
          loading={busy}
          onPress={onKeep}
        />
        <Button
          testID="photo-preset-migrate-not-now"
          variant="secondary"
          label={t('photo.presets.migrate.notNow')}
          disabled={busy}
          onPress={onNotNow}
        />
      </View>
    </Sheet>
  );
}

// i18n-keys: interface:photo.presets.name.color-pop-red, interface:photo.presets.name.color-pop-yellow, interface:photo.presets.name.color-pop-green, interface:photo.presets.name.color-pop-cyan, interface:photo.presets.name.color-pop-blue, interface:photo.presets.name.color-pop-magenta, interface:photo.presets.name.bw-film, interface:photo.presets.name.bw-high-contrast, interface:photo.presets.name.warm, interface:photo.presets.name.cool, interface:photo.presets.name.matte, interface:photo.presets.name.fade, interface:photo.presets.name.vivid, interface:photo.presets.name.punch, interface:photo.presets.name.cross-process, interface:photo.presets.name.vintage, interface:photo.presets.name.portrait-soften, interface:photo.presets.name.landscape, interface:photo.presets.name.auto
export function PresetsSheet({ kv = kvDefault }: { kv?: KvStorage }) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const x = useEditorTools();
  const doc = usePhotoSelector((s) => s.doc);
  const headers = useAuthHeaders();
  const server = useListPhotoPresetsQuery();
  const [createPreset] = useCreatePhotoPresetMutation();
  const [updatePreset] = useUpdatePhotoPresetMutation();
  const [deletePreset] = useDeletePhotoPresetMutation();
  const [uploadThumb] = useUploadPhotoPresetThumbnailMutation();
  const [local, setLocal] = useState<UserPreset[] | null>(null);
  const [declined, setDeclined] = useState<boolean | null>(null);
  const [migrateOpen, setMigrateOpen] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const reloadLocal = useCallback(async () => setLocal(await listUserPresets(kv)), [kv]);
  useEffect(() => {
    let live = true;
    void Promise.all([listUserPresets(kv), migrationDeclined(kv)]).then(([l, d]) => {
      if (!live) return;
      setLocal(l);
      setDeclined(d);
    });
    return () => {
      live = false;
    };
  }, [kv]);

  const mine = server.data?.presets ?? [];
  const device = local ?? [];
  const offer =
    server.isSuccess &&
    local !== null &&
    declined !== null &&
    shouldOfferMigration(mine.length, device, declined);

  /** A refusal: the cap → the limit sheet; no connection → "offline"; else the account failure. */
  const refused = (e: MmError | undefined) => {
    if (e?.code === 'photo_presets_limit' && x.onLimit?.(e)) return;
    if (isOfflineError(e)) return showNotice(t('photo.presets.offline'), 'error');
    if (e?.code === 'photo_presets_limit')
      return showNotice(t('interface:photo.presets.limitReached'), 'error');
    showNotice(t('interface:photo.presets.saveFailedAccount'), 'error');
  };

  const create: CreateAccountPreset = async (p) => {
    try {
      await createPreset(p).unwrap();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e as MmError };
    }
  };

  const nameOf = (id: string) => t(`interface:photo.presets.name.${id}`);
  const apply = (
    id: string,
    layers: AdjustmentLayer[] | null,
    display: string,
    scope: 'builtin' | 'server' | 'local',
  ) => {
    if (!layers || layers.length === 0) return;
    const builtin = scope === 'builtin';
    edit(presetLabel(builtin, builtin ? id : display), (d) => applyPreset(d, id, layers, display));
    x.onPresetApplied?.(builtin ? id : 'custom', scope);
  };

  const save = async () => {
    const n = name.trim();
    if (!n || !doc || doc.layers.length === 0 || busy) return;
    const layers = presetLayersOf(doc.layers);
    setBusy(true);
    try {
      const created = await createPreset({ name: n, category: 'custom', layers }).unwrap();
      x.onPresetSaved?.(layers.length);
      setSaving(false);
      setName('');
      showNotice(t('photo.presets.saved'));
      // Best effort: a failed thumbnail never fails the save (the row renders it locally).
      const uri = await x.presetThumbFile?.(layers);
      if (uri) void uploadThumb({ id: created.id, fileUri: uri });
    } catch (e) {
      refused(e as MmError);
    } finally {
      setBusy(false);
    }
  };

  const doRename = async (p: AccountPreset) => {
    const n = name.trim();
    if (n === '' || n.length > USER_PRESET_NAME_MAX) return;
    try {
      await updatePreset({ id: p.id, revision: p.revision, name: n }).unwrap();
    } catch (e) {
      // A rename changed elsewhere since the list loaded: the name is all we send, so retry once on
      // the server's revision (last writer wins on a name).
      const rev = presetConflictRevision(e as MmError);
      if (rev === null) return refused(e as MmError);
      try {
        await updatePreset({ id: p.id, revision: rev, name: n }).unwrap();
      } catch (e2) {
        return refused(e2 as MmError);
      }
    }
    setRenaming(null);
    setName('');
  };

  const doDelete = async (p: AccountPreset) => {
    try {
      await deletePreset(p.id).unwrap();
    } catch (e) {
      refused(e as MmError);
    }
  };

  const upload = async (p: UserPreset) => {
    setBusy(true);
    const r = await uploadLocalPreset(kv, p, create);
    setBusy(false);
    if (!r.ok) return refused(r.error);
    x.onPresetSaved?.(p.layers.length);
    await reloadLocal();
    showNotice(t('photo.presets.uploaded'));
  };

  const keep = async () => {
    const count = device.length;
    setMigrating(true);
    const r = await migrateLocalPresets(kv, device, create);
    x.onPresetsMigrated?.(count, false);
    setMigrating(false);
    setMigrateOpen(false);
    await reloadLocal();
    if (r.uploaded === 0 && r.error) return refused(r.error);
    if (r.remaining > 0)
      showNotice(t('photo.presets.migrate.partial'), r.capped ? 'info' : 'error');
    else showNotice(t('interface:photo.presets.migrate.done'));
  };

  const notNow = async () => {
    x.onPresetsMigrated?.(device.length, true);
    await setMigrationDeclined(kv);
    setDeclined(true);
    setMigrateOpen(false);
  };

  const exportAll = async () => {
    if (mine.length === 0) return;
    const f = new File(Paths.cache, 'aperture-presets.json');
    if (f.exists) f.delete();
    f.create();
    f.write(exportPresetsJson(mine.map(asUserPreset)));
    await Sharing.shareAsync(f.uri, {
      mimeType: 'application/json',
      dialogTitle: t('interface:photo.presets.export'),
    });
  };

  const importFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    let text = '';
    try {
      text = await new File(res.assets[0].uri).text();
    } catch {
      return showNotice(t('interface:photo.presets.importError.json'), 'error');
    }
    // The account is the active store: validate the whole file, then upload up to the cap.
    const parsed = parseUserPresetsJson(text);
    if (!parsed.ok)
      return showNotice(t(`interface:photo.presets.importError.${parsed.reason}`), 'error');
    setBusy(true);
    let failure: MmError | undefined;
    for (const p of parsed.presets) {
      const r = await create({ name: p.name, category: p.category, layers: p.layers });
      if (r.ok) continue;
      failure ??= r.error;
      if (r.error.code === 'photo_presets_limit' || isOfflineError(r.error)) break;
    }
    setBusy(false);
    if (failure) return refused(failure);
    showNotice(t('interface:photo.presets.imported'));
  };

  const hist = x.histogram256?.() ?? null;
  return (
    <View className="gap-4" testID="photo-presets-sheet">
      <Text className="text-sm text-muted-fg">{t('interface:photo.presets.appendNote')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3"
      >
        {BUILTIN_PRESETS.map((p) => {
          const layers = builtinLayers(p.id, hist);
          return (
            <Pressable
              key={p.id}
              testID={`photo-preset-${p.id}`}
              accessibilityRole="button"
              accessibilityLabel={nameOf(p.id)}
              disabled={!layers}
              onPress={() => apply(p.id, layers, nameOf(p.id), 'builtin')}
            >
              <Thumb
                image={layers ? (x.presetThumb?.(p.id, layers) ?? null) : null}
                label={nameOf(p.id)}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.presets.mine')}</Text>
        <Text className="text-sm text-muted-fg">{t('interface:photo.presets.accountNote')}</Text>
        {server.isLoading ? (
          <Text className="text-sm text-muted-fg">{t('common.loading')}</Text>
        ) : server.isError && !server.data ? (
          <View className="gap-2" testID="photo-presets-load-failed">
            <Text className="text-sm text-muted-fg">
              {isOfflineError(server.error as MmError | undefined)
                ? t('photo.presets.offline')
                : t('photo.presets.loadFailed')}
            </Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void server.refetch()}
            />
          </View>
        ) : mine.length === 0 ? (
          <Text className="text-sm text-muted-fg">{t('interface:photo.presets.noneYet')}</Text>
        ) : (
          mine.map((p) => (
            <View
              key={p.id}
              className="gap-1 rounded-md border border-edge p-2"
              testID={`photo-user-preset-${p.id}`}
            >
              {renaming === p.id ? (
                <>
                  <TextField
                    label={t('interface:photo.presets.nameLabel')}
                    value={name}
                    onChangeText={setName}
                    maxLength={USER_PRESET_NAME_MAX}
                  />
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      testID={`photo-preset-rename-save-${p.id}`}
                      label={t('interface:photo.presets.save')}
                      disabled={!name.trim()}
                      onPress={() => void doRename(p)}
                    />
                    <Button
                      variant="secondary"
                      label={t('interface:photo.presets.cancel')}
                      onPress={() => setRenaming(null)}
                    />
                  </View>
                </>
              ) : (
                <Pressable
                  testID={`photo-user-preset-apply-${p.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={p.name}
                  className="flex-row items-center gap-3"
                  onPress={() => apply(p.id, p.layers, p.name, 'server')}
                >
                  <RowThumb
                    preset={p}
                    headers={headers}
                    local={
                      p.hasThumbnail
                        ? null
                        : (x.presetThumb?.(`account:${p.id}:${p.revision}`, p.layers) ?? null)
                    }
                  />
                  <View className="flex-1">
                    <Text className="font-semibold" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-xs text-muted-fg">
                      {t('interface:photo.presets.layerCount', { count: p.layers.length })}
                    </Text>
                  </View>
                </Pressable>
              )}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  testID={`photo-preset-rename-${p.id}`}
                  variant="secondary"
                  label={t('interface:photo.presets.rename')}
                  onPress={() => {
                    setRenaming(p.id);
                    setName(p.name);
                  }}
                />
                <Button
                  testID={`photo-preset-delete-${p.id}`}
                  variant="secondary"
                  label={t('interface:photo.presets.delete')}
                  onPress={() => void doDelete(p)}
                />
              </View>
            </View>
          ))
        )}
        {saving ? (
          <View className="gap-2">
            <TextField
              testID="photo-preset-name"
              label={t('interface:photo.presets.nameLabel')}
              placeholder={t('interface:photo.presets.namePlaceholder')}
              value={name}
              onChangeText={setName}
              maxLength={USER_PRESET_NAME_MAX}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                testID="photo-preset-save"
                label={t('interface:photo.presets.save')}
                onPress={() => void save()}
                loading={busy}
                disabled={!name.trim()}
              />
              <Button
                variant="secondary"
                label={t('interface:photo.presets.cancel')}
                onPress={() => setSaving(false)}
              />
            </View>
          </View>
        ) : (
          <Button
            testID="photo-preset-save-current"
            variant="secondary"
            label={t('interface:photo.presets.saveCurrent')}
            disabled={!doc || doc.layers.length === 0}
            onPress={() => setSaving(true)}
          />
        )}
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="photo-preset-import"
            variant="secondary"
            label={t('interface:photo.presets.import')}
            disabled={busy}
            onPress={() => void importFile()}
          />
          <Button
            testID="photo-preset-export"
            variant="secondary"
            label={t('interface:photo.presets.export')}
            disabled={mine.length === 0}
            onPress={() => void exportAll()}
          />
        </View>
      </View>

      {device.length > 0 && !offer ? (
        <View className="gap-2" testID="photo-device-presets">
          <Text className="font-semibold">{t('photo.presets.device.title')}</Text>
          <Text className="text-sm text-muted-fg">{t('photo.presets.device.note')}</Text>
          {device.map((p) => (
            <View
              key={p.id}
              className="flex-row items-center gap-3 rounded-md border border-edge p-2"
              testID={`photo-device-preset-${p.id}`}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={p.name}
                className="flex-1 flex-row items-center gap-3"
                onPress={() => apply(p.id, p.layers, p.name, 'local')}
              >
                <RowThumb
                  preset={p}
                  headers={null}
                  local={x.presetThumb?.(`device:${p.id}`, p.layers) ?? null}
                />
                <View className="flex-1">
                  <Text className="font-semibold" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text className="text-xs text-muted-fg">
                    {t('interface:photo.presets.layerCount', { count: p.layers.length })}
                  </Text>
                </View>
              </Pressable>
              <Button
                testID={`photo-device-preset-upload-${p.id}`}
                variant="secondary"
                label={t('photo.presets.upload')}
                disabled={busy}
                onPress={() => void upload(p)}
              />
            </View>
          ))}
        </View>
      ) : null}

      <PresetMigrationSheet
        visible={offer && migrateOpen}
        count={device.length}
        busy={migrating}
        onKeep={() => void keep()}
        onNotNow={() => void notNow()}
        onClose={() => setMigrateOpen(false)}
      />
    </View>
  );
}
