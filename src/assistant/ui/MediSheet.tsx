import { useRouter } from 'expo-router';
import { History, Plus, Send, Square, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  I18nManager,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import {
  HISTORY_LIMIT,
  useDeleteAssistantConversationMutation,
  useLazyGetAssistantConversationQuery,
  useListGuideConversationsQuery,
  useSendAssistantFeedbackMutation,
} from '@/api/endpoints/assistant';
import type { AssistantActionEvent, AssistantConversation } from '@/api/schemas/assistant';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { Segmented } from '@/ui/components/Segmented';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';
import { openWebPage } from '@/account/openWeb';
import { MEDI_BRAND } from '../brand';
import { errorKey } from '../errorKey';
import {
  linkTargetKind,
  resolveAction,
  resolveSitePath,
  safeSitePath,
  type MediTarget,
} from '../links';
import { closeMedi, useMediUi } from '../mediUi';
import { openTarget } from '../openTarget';
import { useMediChat, type MediMessage, type StreamFn } from '../useMediChat';
import { Markdown } from './Markdown';
import { MediMark } from './MediMark';

// i18n-keys: assistant.starters.whichTool, assistant.starters.gif, assistant.starters.premium, assistant.starters.photoPro, assistant.errors.upstream, assistant.errors.rateLimited, assistant.errors.paused, assistant.errors.signIn, assistant.errors.unavailable, assistant.errors.network, assistant.errors.generic
/** The API's limit (`assistant.MaxMessageChars`, also in `GET /assistant/capabilities`). */
export const MAX_MESSAGE_CHARS = 4000;
const STARTERS = ['whichTool', 'gif', 'premium', 'photoPro'] as const;
const ACTION_KINDS = new Set(['navigate', 'open_tool', 'confirm_job']);

type View_ = 'chat' | 'history';

/**
 * Medi's full-height chat sheet (ticket MA54 decision 2). Mount once (`MediHost`); the Tools tab opens
 * it through `openMedi`. Closing aborts the request in flight (decision 3).
 */
export function MediSheet({ stream }: { stream?: StreamFn } = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const locale = useActiveLocale();
  const ui = useMediUi();
  const chat = useMediChat({ locale, stream });
  const [view, setView] = useState<View_>('chat');
  const [draft, setDraft] = useState('');
  const list = useRef<ScrollView>(null);
  const brand = { brand: MEDI_BRAND };

  // Each open (and each prefill while open) resets the view and lands the search text in the composer.
  const [seenNonce, setSeenNonce] = useState(ui.nonce);
  if (seenNonce !== ui.nonce) {
    setSeenNonce(ui.nonce);
    if (ui.open) {
      setView('chat');
      if (ui.prefill) setDraft(ui.prefill.slice(0, MAX_MESSAGE_CHARS));
    }
  }

  const { stop } = chat;
  useEffect(() => {
    if (!ui.open) stop();
  }, [ui.open, stop]);

  const close = useCallback(() => {
    stop();
    closeMedi();
  }, [stop]);

  const submit = (text: string) => {
    if (chat.send(text)) setDraft('');
  };

  const goTo = (target: MediTarget) => {
    const how = openTarget(target, {
      push: (href) => router.push(href),
      openWeb: openWebPage,
    });
    if (how !== 'web') close();
  };

  const onAction = (a: AssistantActionEvent) => {
    const target = resolveAction(a.kind, a.params, locale);
    if (!target) return;
    track(EVENTS.ASSISTANT_ACTION_CLICKED, {
      surface: 'guide',
      kind: a.kind === 'navigate' ? 'navigate' : 'open_tool',
    });
    goTo(target);
  };

  const onLink = (href: string) => {
    const path = safeSitePath(href);
    if (!path) return;
    track(EVENTS.ASSISTANT_LINK_CLICKED, { surface: 'guide', target_kind: linkTargetKind(path) });
    goTo(resolveSitePath(path, locale));
  };

  const messages = chat.messages;
  useEffect(() => {
    list.current?.scrollToEnd({ animated: true });
  }, [messages]);

  return (
    <Sheet visible={ui.open} onClose={close} fullHeight>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View className="flex-row items-center gap-3 pb-3">
          <MediMark size={32} />
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-base font-semibold">
              {t('assistant.title', brand)}
            </Text>
            <Text className="text-xs text-muted-fg" numberOfLines={1}>
              {t('assistant.subtitle')}
            </Text>
          </View>
          <IconButton
            testID="medi-new-chat"
            label={t('assistant.newChat')}
            onPress={() => {
              chat.reset();
              setView('chat');
            }}
          >
            <Plus size={20} color={colors.foreground} />
          </IconButton>
          <IconButton testID="medi-close" label={t('common.close')} onPress={close}>
            <X size={20} color={colors.foreground} />
          </IconButton>
        </View>

        <Segmented<View_>
          options={[
            { value: 'chat', label: t('assistant.chat') },
            { value: 'history', label: t('assistant.history') },
          ]}
          value={view}
          onChange={setView}
        />

        {view === 'history' ? (
          <HistoryView
            onOpen={(detail) => {
              chat.load(detail);
              setView('chat');
            }}
          />
        ) : (
          <>
            <ScrollView
              ref={list}
              className="mt-3 flex-1"
              contentContainerClassName="gap-4 pb-3"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              testID="medi-messages"
            >
              {messages.length === 0 ? (
                <View className="gap-3">
                  <Text className="text-muted-fg">{t('assistant.welcome', brand)}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {STARTERS.map((k) => (
                      <Pressable
                        key={k}
                        testID={`medi-starter-${k}`}
                        accessibilityRole="button"
                        onPress={() => submit(t(`assistant.starters.${k}`))}
                        className="justify-center rounded-full border border-edge-control bg-surface-2 px-3"
                        style={{ minHeight: hitTarget }}
                      >
                        <Text className="text-sm">{t(`assistant.starters.${k}`)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {messages.map((m) => (
                <MessageView
                  key={m.key}
                  m={m}
                  onAction={onAction}
                  onLink={onLink}
                  onAsk={submit}
                  locale={locale}
                />
              ))}
            </ScrollView>

            <Text className="pb-2 pt-1 text-xs text-subtle">
              {t('assistant.disclaimer', brand)}
            </Text>
            <View className="flex-row items-end gap-2">
              <TextInput
                testID="medi-input"
                value={draft}
                onChangeText={setDraft}
                placeholder={t('assistant.placeholder', brand)}
                placeholderTextColor={colors.subtle}
                accessibilityLabel={t('assistant.placeholder', brand)}
                multiline
                maxLength={MAX_MESSAGE_CHARS}
                className="flex-1 rounded-md border border-edge-control bg-surface-2 px-3 py-2 font-sans text-foreground"
                style={{ minHeight: hitTarget, maxHeight: 120, textAlign: 'auto' }}
              />
              {chat.streaming ? (
                <IconButton
                  testID="medi-stop"
                  label={t('assistant.stop')}
                  onPress={chat.stop}
                  filled
                >
                  <Square size={18} color={colors.onPrimary} fill={colors.onPrimary} />
                </IconButton>
              ) : (
                <IconButton
                  testID="medi-send"
                  label={t('assistant.send')}
                  onPress={() => submit(draft)}
                  disabled={draft.trim() === ''}
                  filled
                >
                  <Send
                    size={18}
                    color={colors.onPrimary}
                    style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
                  />
                </IconButton>
              )}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Sheet>
  );
}

function IconButton({
  children,
  label,
  onPress,
  testID,
  disabled,
  filled,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  filled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`items-center justify-center rounded-md ${filled ? 'bg-primary' : ''} ${disabled ? 'opacity-40' : ''}`}
      style={{ width: hitTarget, height: hitTarget }}
    >
      {children}
    </Pressable>
  );
}

function MessageView({
  m,
  onAction,
  onLink,
  onAsk,
  locale,
}: {
  m: MediMessage;
  onAction: (a: AssistantActionEvent) => void;
  onLink: (href: string) => void;
  onAsk: (choice: string) => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const brand = { brand: MEDI_BRAND };
  if (m.role === 'user') {
    return (
      <View
        className="max-w-[88%] self-end rounded-lg bg-surface-3 px-3 py-2"
        testID="medi-user-msg"
      >
        <Text>{m.text}</Text>
      </View>
    );
  }
  const actions = m.actions.filter(
    (a) => ACTION_KINDS.has(a.kind) && resolveAction(a.kind, a.params, locale) !== null,
  );
  return (
    <View className="gap-2 self-start" style={{ maxWidth: '96%' }} testID="medi-assistant-msg">
      {m.outcome === 'static' && !m.text ? (
        <Text className="text-muted-fg">{t('assistant.resting')}</Text>
      ) : null}
      {m.text ? (
        <Markdown content={m.text} onLink={onLink} isSafeLink={(h) => safeSitePath(h) !== null} />
      ) : null}
      {m.status === 'streaming' ? (
        <View className="flex-row items-center gap-2" testID="medi-activity">
          <ActivityIndicator size="small" color={colors.mutedFg} />
          <Text className="text-sm text-muted-fg">
            {m.tool ? t('assistant.searching') : t('assistant.thinking')}
          </Text>
        </View>
      ) : null}
      {m.status === 'stopped' ? (
        <Text className="text-sm text-muted-fg">{t('assistant.stopped')}</Text>
      ) : null}
      {m.status === 'error' ? (
        <Text className="text-sm text-danger" accessibilityLiveRegion="polite" testID="medi-error">
          {t(`assistant.errors.${errorKey(m.errorCode)}`, brand)}
        </Text>
      ) : null}
      {actions.map((a) => {
        const target = resolveAction(a.kind, a.params, locale)!;
        return (
          <Pressable
            key={a.callId}
            testID={`medi-action-${a.callId}`}
            accessibilityRole="button"
            onPress={() => onAction(a)}
            className="items-center justify-center rounded-md bg-primary px-4"
            style={{ minHeight: hitTarget }}
          >
            <Text className="font-semibold text-on-primary" numberOfLines={2}>
              {target.kind === 'web' ? t('assistant.openOnWeb') : a.label}
            </Text>
          </Pressable>
        );
      })}
      {m.ask ? (
        <View className="gap-2" testID="medi-ask">
          <Text className="font-semibold">{m.ask.question}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(m.ask.choices ?? []).map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                onPress={() => onAsk(c)}
                className="justify-center rounded-full border border-edge-control bg-surface-2 px-3"
                style={{ minHeight: hitTarget }}
              >
                <Text className="text-sm">{c}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {m.status === 'complete' && m.messageId ? <Feedback messageId={m.messageId} /> : null}
    </View>
  );
}

/** One up/down per stored answer (signed-in only: the id exists only then). Best-effort POST. */
function Feedback({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const [rated, setRated] = useState<'up' | 'down' | null>(null);
  const [send] = useSendAssistantFeedbackMutation();
  if (rated) return <Text className="text-xs text-muted-fg">{t('assistant.thanks')}</Text>;
  const rate = (rating: 'up' | 'down') => {
    setRated(rating);
    track(EVENTS.ASSISTANT_FEEDBACK_GIVEN, { surface: 'guide', rating });
    void send({ messageId, rating });
  };
  return (
    <View className="flex-row" testID="medi-feedback">
      <IconButton testID="medi-up" label={t('assistant.helpful')} onPress={() => rate('up')}>
        <ThumbsUp size={16} color={colors.mutedFg} />
      </IconButton>
      <IconButton testID="medi-down" label={t('assistant.notHelpful')} onPress={() => rate('down')}>
        <ThumbsDown size={16} color={colors.mutedFg} />
      </IconButton>
    </View>
  );
}

function HistoryView({
  onOpen,
}: {
  onOpen: (detail: Parameters<ReturnType<typeof useMediChat>['load']>[0]) => void;
}) {
  const { t } = useTranslation();
  const q = useListGuideConversationsQuery(undefined, { refetchOnMountOrArgChange: true });
  const [fetchOne] = useLazyGetAssistantConversationQuery();
  const [del] = useDeleteAssistantConversationMutation();
  const [failed, setFailed] = useState(false);

  const open = async (c: AssistantConversation) => {
    setFailed(false);
    const r = await fetchOne(c.id);
    if (r.data) onOpen(r.data);
    else setFailed(true);
  };

  if (q.isLoading) {
    return (
      <View className="mt-6 items-center" testID="medi-history-loading">
        <ActivityIndicator color={colors.mutedFg} />
      </View>
    );
  }
  if (q.isError) {
    return (
      <View className="mt-6 items-center gap-2" testID="medi-history-error">
        <Text className="text-center text-muted-fg">{t('assistant.historyLoadFailed')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => q.refetch()}
          style={{ minHeight: hitTarget }}
        >
          <Text className="font-semibold text-primary">{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  const items = (q.data ?? []).slice(0, HISTORY_LIMIT);
  if (items.length === 0) {
    return (
      <Text className="mt-6 text-center text-muted-fg" testID="medi-history-empty">
        {t('assistant.historyEmpty', { brand: MEDI_BRAND })}
      </Text>
    );
  }
  return (
    <ScrollView
      className="mt-3 flex-1"
      contentContainerClassName="gap-2 pb-3"
      testID="medi-history"
    >
      {failed ? <Text className="text-danger">{t('assistant.historyLoadFailed')}</Text> : null}
      {items.map((c) => (
        <View
          key={c.id}
          className="flex-row items-center rounded-md border border-edge bg-surface-2"
        >
          <Pressable
            testID={`medi-conv-${c.id}`}
            accessibilityRole="button"
            onPress={() => void open(c)}
            className="flex-1 flex-row items-center gap-2 px-3"
            style={{ minHeight: hitTarget }}
          >
            <History size={16} color={colors.mutedFg} />
            <Text className="flex-1" numberOfLines={2}>
              {c.title?.trim() || t('assistant.untitled')}
            </Text>
          </Pressable>
          <IconButton
            testID={`medi-del-${c.id}`}
            label={t('assistant.deleteChat')}
            onPress={() => void del(c.id)}
          >
            <Trash2 size={18} color={colors.mutedFg} />
          </IconButton>
        </View>
      ))}
    </ScrollView>
  );
}
