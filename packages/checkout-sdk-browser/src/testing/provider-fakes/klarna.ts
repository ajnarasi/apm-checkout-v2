/**
 * Klarna provider fake — installs `window.Klarna` with deterministic
 * test-friendly responses. Does NOT load anything from the real Klarna CDN.
 *
 * Architect Pass #2 P1: "Provider fakes directory so 'real SDK code, mocked
 * network' is actually testable. Without this, unit tests either hit CDN or lie."
 *
 * Usage in vitest:
 *   import { installKlarnaFake, uninstallKlarnaFake } from './testing/provider-fakes/klarna.js';
 *   beforeEach(() => installKlarnaFake({ approved: true }));
 *   afterEach(() => uninstallKlarnaFake());
 */

export interface KlarnaFakeConfig {
  /** Whether the fake authorize() should report approved: true. Default true. */
  approved?: boolean;
  /** The fake authorization_token to return. Default 'klarna-fake-tok-1'. */
  authorizationToken?: string;
  /** Whether load() should report show_form: true. Default true. */
  loadSucceeds?: boolean;
  /** Optional invalid_fields to surface on failure. */
  invalidFields?: string[];
}

let originalKlarna: unknown;

export function installKlarnaFake(config: KlarnaFakeConfig = {}): void {
  if (typeof window === 'undefined') return;
  originalKlarna = (window as unknown as Record<string, unknown>).Klarna;

  const cfg = {
    approved: true,
    authorizationToken: 'klarna-fake-tok-1',
    loadSucceeds: true,
    ...config,
  };

  (window as unknown as Record<string, unknown>).Klarna = {
    Payments: {
      init: (_opts: { client_token: string }) => {
        // No-op; real Klarna stores the token internally.
      },
      load: (
        _opts: { container: string; payment_method_category?: string },
        cb: (res: { show_form: boolean; error?: { invalid_fields?: string[] } }) => void
      ) => {
        // Resolve on next tick to mimic async behavior.
        setTimeout(() => {
          cb(
            cfg.loadSucceeds
              ? { show_form: true }
              : { show_form: false, error: { invalid_fields: cfg.invalidFields } }
          );
        }, 0);
      },
      authorize: (
        _opts: { payment_method_category?: string; auto_finalize?: boolean },
        _data: Record<string, unknown>,
        cb: (res: {
          approved: boolean;
          authorization_token?: string;
          error?: { invalid_fields?: string[] };
        }) => void
      ) => {
        setTimeout(() => {
          cb(
            cfg.approved
              ? { approved: true, authorization_token: cfg.authorizationToken }
              : { approved: false, error: { invalid_fields: cfg.invalidFields } }
          );
        }, 0);
      },
    },
  };
}

export function uninstallKlarnaFake(): void {
  if (typeof window === 'undefined') return;
  if (originalKlarna === undefined) {
    delete (window as unknown as Record<string, unknown>).Klarna;
  } else {
    (window as unknown as Record<string, unknown>).Klarna = originalKlarna;
  }
  originalKlarna = undefined;
}
