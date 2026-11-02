import { ANALYSIS_MAX_MS, ANALYSIS_POLL_MS } from '@/api/endpoints/transcript';

/** Poll interval while the summary is still being written, `0` (stop) after the cap or once it exists. */
export function analysisPollInterval(startedAt: number, now: number, hasData: boolean): number {
  if (hasData) return 0;
  return now - startedAt >= ANALYSIS_MAX_MS ? 0 : ANALYSIS_POLL_MS;
}

export type AnalysisUiState = 'ready' | 'running' | 'unavailable';

export function analysisUiState(hasData: boolean, startedAt: number, now: number): AnalysisUiState {
  if (hasData) return 'ready';
  return now - startedAt >= ANALYSIS_MAX_MS ? 'unavailable' : 'running';
}
