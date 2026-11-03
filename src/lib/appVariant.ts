import * as Application from 'expo-application';

export type AppVariant = 'development' | 'preview' | 'production';

/** From the installed application id (app.config.ts suffixes `.dev` / `.preview`); unknown = development. */
export function appVariant(
  applicationId: string | null | undefined = Application.applicationId,
): AppVariant {
  if (!applicationId || applicationId.endsWith('.dev')) return 'development';
  if (applicationId.endsWith('.preview')) return 'preview';
  return 'production';
}
