import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { MmError } from '@/api/errors';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { formatNumber, formatTimeLeft } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { exceededScope, limitVariantFor, type LimitVariant } from './limitVariant';
import { PlanSheet } from './PlanSheet';
import { higherTierFact, higherTierValues, limitKeyForMetric, type TierFactKey } from './tierFacts';
import { factText, useCurrentTier, useTierList } from './useTierFacts';
import { useAccountLimitsFull } from './useAccountLimitsFull';
import { formatLimitValue } from './valueFormat';

/** Event props for `quota_exceeded_shown`; the scope follows the web (`metric` or `detail.error`). */
export function exceededProps(v: LimitVariant, limit: number | undefined, toolSlug?: string) {
  const scope = exceededScope(v);
  if (!scope) return null;
  return {
    ...(limit !== undefined ? { limit } : {}),
    scope,
    ...(toolSlug ? { tool_slug: toolSlug } : {}),
  };
}

export interface LimitSheetProps {
  visible: boolean;
  error: MmError | undefined;
  onClose: () => void;
  /** `context.tool_slug` for the event. */
  toolSlug?: string;
  /** Named slot MA42 (purchase) and MA46 (rewarded ad) fill later; renders nothing today. */
  footerExtra?: ReactNode;
}

/**
 * One bottom sheet, one variant per refusal (429 quota, 429 rate limit, 403 output height,
 * 413 size / too long / deployment cap). Neutral facts only; nothing links out (MA-0008).
 */
export function LimitSheet({ visible, error, onClose, toolSlug, footerExtra }: LimitSheetProps) {
  const { t } = useTranslation();
  const tiers = useTierList();
  const tier = useCurrentTier();
  const limits = useAccountLimitsFull();
  const [seeAll, setSeeAll] = useState(false);
  const variant = limitVariantFor(error);

  const limitForEvent = (() => {
    if (!variant) return undefined;
    if (variant.kind === 'quota') return variant.limit;
    if (variant.kind === 'height') return variant.limit;
    if (variant.kind === 'size') return limits?.maxFileBytes;
    if (variant.kind === 'long') return limits?.maxVideoSeconds;
    if (variant.kind === 'presets') return variant.limit;
    return undefined;
  })();

  const fired = useRef(false);
  useEffect(() => {
    if (!visible) {
      fired.current = false;
      return;
    }
    if (fired.current || !variant) return;
    fired.current = true;
    const props = exceededProps(variant, limitForEvent, toolSlug);
    if (props) track(EVENTS.QUOTA_EXCEEDED_SHOWN, props);
  });

  if (!variant) return null;
  return (
    <>
      <Sheet visible={visible && !seeAll} onClose={onClose}>
        <View className="gap-3" testID={`limit-sheet-${variant.kind}`}>
          {variant.kind === 'rate' ? (
            <RateBody
              key={error?.details ? JSON.stringify(error.details) : 'r'}
              seconds={variant.seconds}
              onClose={onClose}
            />
          ) : (
            <>
              <Body variant={variant} limits={limits} tiers={tiers} tier={tier} />
              {variant.kind === 'quota' ? (
                <Button label={t('quota.seeAll')} variant="ghost" onPress={() => setSeeAll(true)} />
              ) : null}
              {footerExtra}
              <Button label={t('quota.ok')} variant="secondary" onPress={onClose} />
            </>
          )}
        </View>
      </Sheet>
      <PlanSheet
        visible={visible && seeAll}
        onClose={() => {
          setSeeAll(false);
          onClose();
        }}
      />
    </>
  );
}

function Body({
  variant,
  limits,
  tiers,
  tier,
}: {
  variant: Exclude<LimitVariant, { kind: 'rate' }>;
  limits: ReturnType<typeof useAccountLimitsFull>;
  tiers: ReturnType<typeof useTierList>;
  tier: string | null;
}) {
  const { t } = useTranslation();
  const facts: string[] = [];
  let title = '';
  let body: string | null = null;

  if (variant.kind === 'quota') {
    const metricName = t(`quota.metricName.${variant.metric}`);
    title = t('quota.exceeded.title', {
      limit: formatNumber(variant.limit ?? 0),
      metricName,
    });
    body = variant.resetsAt
      ? t('quota.exceeded.body', { time: formatTimeLeft(variant.resetsAt) })
      : t('quota.exceeded.bodyNoTime');
    const key = limitKeyForMetric(variant.metric);
    for (const { tier: name, value } of higherTierValues(key, tiers, tier)) {
      facts.push(
        t('quota.compareRow', {
          tier: t(`quota.tiers.${name}`),
          value: formatLimitValue(key, value),
        }),
      );
    }
  } else if (variant.kind === 'height') {
    title = t('interface:upgradeInterstitial.outputHeight.title');
    body = t('interface:upgradeInterstitial.outputHeight.body', {
      requested: variant.requested ?? '—',
      limit: variant.limit ?? '—',
    });
    const fact = higherTierFact('maxOutputHeight', tiers, tier);
    if (fact) facts.push(factText(t, fact));
    else body = `${body} ${t('quota.heightLimited.lower')}`;
  } else if (variant.kind === 'size') {
    title = t('interface:upgradeInterstitial.fileSize.title');
    body = t('interface:upgradeInterstitial.fileSize.body', {
      limit: limits ? formatLimitValue('maxFileBytes', limits.maxFileBytes) : '—',
    });
    const fact = higherTierFact('maxFileBytes', tiers, tier);
    if (fact) facts.push(factText(t, fact));
  } else if (variant.kind === 'long') {
    title = t('quota.tooLong.title');
    body = t('quota.tooLong.body', {
      limit: limits ? formatLimitValue('maxVideoSeconds', limits.maxVideoSeconds) : '—',
    });
    const fact = higherTierFact('maxVideoSeconds', tiers, tier);
    if (fact) facts.push(factText(t, fact));
  } else if (variant.kind === 'presets') {
    // MA53 (MA-0008): the neutral cap line only, no plan comparison or purchase link.
    title = t('interface:photo.presets.limitReached');
    body =
      variant.limit !== undefined && variant.limit >= 0
        ? t('photo.presets.cap', { count: variant.limit })
        : null;
  } else {
    // Deployment caps are not tier caps: no higher-tier row.
    title = t('quota.deploymentCap.title');
    body = t('quota.deploymentCap.body');
  }

  return (
    <>
      <Text className="text-lg font-semibold">{title}</Text>
      {body ? <Text className="text-muted-fg">{body}</Text> : null}
      {facts.map((f) => (
        <Text key={f} className="text-sm" testID="limit-fact">
          {f}
        </Text>
      ))}
    </>
  );
}

/** "Too many requests. Try again in N s." with a live countdown; Try again enables at 0. */
function RateBody({ seconds, onClose }: { seconds: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return (
    <>
      <Text className="text-lg font-semibold">{t('quota.rateLimited.title')}</Text>
      {left > 0 ? (
        <Num className="text-muted-fg" testID="rate-countdown">
          {t('quota.rateLimited.body', { seconds: formatNumber(left) })}
        </Num>
      ) : (
        <Text className="text-muted-fg">{t('quota.rateLimited.ready')}</Text>
      )}
      <Button label={t('quota.tryAgain')} disabled={left > 0} onPress={onClose} />
      <Button label={t('quota.ok')} variant="secondary" onPress={onClose} />
    </>
  );
}

export type { TierFactKey };

/** Whether a rejected record's error has a sheet (job screen auto-open + Details). */
export function hasLimitSheet(error: MmError | undefined): boolean {
  return limitVariantFor(error) !== null;
}
