import { quotaMetricForJob } from '../metric';

describe('quotaMetricForJob (TS port of quota_metric.go)', () => {
  it('transcribe mode spends ai_ops (case/space tolerant)', () => {
    expect(quotaMetricForJob({ mode: ' Transcribe ' })).toBe('ai_ops');
  });
  it('model-run AI ops spend ai_ops only when enabled', () => {
    expect(quotaMetricForJob({ ai: { enabled: true, operation: 'ai_upscale' } })).toBe('ai_ops');
    expect(quotaMetricForJob({ ai: { enabled: false, operation: 'ai_upscale' } })).toBe('ops');
  });
  it('remove_background, clean_voice, remove_background_noise, unknown and none spend ops', () => {
    for (const operation of [
      'remove_background',
      'clean_voice',
      'remove_background_noise',
      'bogus',
      'none',
    ])
      expect(quotaMetricForJob({ ai: { enabled: true, operation } })).toBe('ops');
    expect(quotaMetricForJob({})).toBe('ops');
  });
});
