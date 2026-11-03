export interface DiagnosticsInfo {
  version: string;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  apiBaseUrl: string;
  application: string | null;
}

/** Plain-text block for "Copy diagnostics". No uid, no email, no tokens (**proposed**; ticket decision 13). */
export function diagnosticsText(i: DiagnosticsInfo): string {
  let host = i.apiBaseUrl;
  try {
    host = new URL(i.apiBaseUrl).host;
  } catch {
    // keep raw
  }
  return [
    `Media Manipulator ${i.version}`,
    `App id: ${i.application ?? 'unknown'}`,
    `Update: ${i.updateId ?? 'embedded'}`,
    `Channel: ${i.channel ?? 'none'}`,
    `Runtime: ${i.runtimeVersion ?? 'none'}`,
    `Server: ${host}`,
  ].join('\n');
}
