/** The `assistant.errors.*` key for a stream error / refusal code. */
export function errorKey(
  code: string | null,
): 'upstream' | 'rateLimited' | 'paused' | 'signIn' | 'unavailable' | 'network' | 'generic' {
  switch (code) {
    case 'rate_limited':
      return 'rateLimited';
    case 'assistant_paused':
      return 'paused';
    case 'sign_in_required':
      return 'signIn';
    case 'not_found':
      return 'unavailable';
    case 'network':
      return 'network';
    case 'upstream':
    case 'tool_limit':
      return 'upstream';
    default:
      return 'generic';
  }
}
