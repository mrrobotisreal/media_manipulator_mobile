import { errorProps } from './clientError';
import { crashlyticsRecord } from './crashlytics';
import { EVENTS, type ClientErrorProps } from './events';

type Track = (name: typeof EVENTS.CLIENT_ERROR, props: ClientErrorProps) => void;

export interface ErrorHandlerDeps {
  track: Track;
  /** Fatal JS error: the process is about to die, write the outbox now. */
  persistNow: () => void;
}

let deps: ErrorHandlerDeps | null = null;

/** `client_error` for one thrown value (+ a Crashlytics non-fatal when `record`). Never throws. */
export function reportClientError(
  error: unknown,
  source: NonNullable<ClientErrorProps['source']>,
  opts: { stage?: string; record?: boolean } = {},
): void {
  try {
    deps?.track(EVENTS.CLIENT_ERROR, errorProps(error, source, opts.stage));
    if (opts.record) crashlyticsRecord(error);
  } catch {
    // error reporting must never cause an error
  }
}

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

interface HermesLike {
  enablePromiseRejectionTracker?: (opts: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

/**
 * (b) Global JS handler, chained in front of the previous one (RNFirebase Crashlytics' handler,
 * which records fatal errors itself, then RN's default) and (c) Hermes unhandled rejections
 * (RN 0.86 only tracks them in __DEV__, for LogBox; RNFirebase's tracker targets the `promise`
 * polyfill, which Hermes does not use). Returns an uninstall function (tests).
 */
export function installErrorHandlers(
  d: ErrorHandlerDeps,
  env: {
    errorUtils?: ErrorUtilsLike;
    hermes?: HermesLike;
    devRejectionOptions?: {
      onUnhandled?: (id: number, r: unknown) => void;
      onHandled?: (id: number) => void;
    };
  } = {},
): () => void {
  deps = d;
  const eu = env.errorUtils ?? (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const prev = eu?.getGlobalHandler();
  if (eu && prev) {
    eu.setGlobalHandler((error, isFatal) => {
      reportClientError(error, 'window', { stage: isFatal ? 'fatal' : undefined });
      if (isFatal) {
        try {
          d.persistNow();
        } catch {
          // ignore
        }
      }
      prev(error, isFatal);
    });
  }
  const hermes = env.hermes ?? (globalThis as { HermesInternal?: HermesLike }).HermesInternal;
  const dev = env.devRejectionOptions;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, rejection) => {
      reportClientError(rejection, 'promise', { record: true });
      dev?.onUnhandled?.(id, rejection);
    },
    onHandled: (id) => dev?.onHandled?.(id),
  });
  return () => {
    if (eu && prev) eu.setGlobalHandler(prev);
    deps = null;
  };
}
