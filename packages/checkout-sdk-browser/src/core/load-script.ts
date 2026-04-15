/**
 * loadScript — shared SRI-capable provider SDK loader.
 *
 * Architect Pass #2 P0 #1 satisfied via the per-base-class `loadProviderSdk()`
 * method calling this helper. Centralizes:
 *   - Idempotent script injection (won't double-load the same URL)
 *   - SRI hash support (when an `integrity` is declared in capabilities)
 *   - `script_load_failed` distinct terminal state via the rejected promise
 *   - Async + crossorigin attributes set correctly for CORS-enabled CDNs
 *
 * Usage from a base class:
 *   await loadScript({ url, integrity, globalCheck: () => 'Klarna' in window });
 */

export interface LoadScriptOptions {
  /** Absolute URL of the provider SDK script. */
  url: string;
  /** Subresource Integrity hash (sha384-...). Omit if the provider doesn't publish one. */
  integrity?: string;
  /**
   * Predicate that returns true once the SDK is available on `window`.
   * Used to short-circuit if the script is already loaded.
   */
  globalCheck?: () => boolean;
  /** Override for `crossorigin` attribute. Default: 'anonymous'. */
  crossOrigin?: 'anonymous' | 'use-credentials' | '';
  /** Timeout in ms before failing. Default: 15000. */
  timeoutMs?: number;
}

export class ScriptLoadError extends Error {
  readonly url: string;
  constructor(url: string, message: string) {
    super(`Failed to load script "${url}": ${message}`);
    this.name = 'ScriptLoadError';
    this.url = url;
  }
}

/**
 * Load a provider SDK script. Resolves once the script's `load` event fires.
 *
 * Idempotent: if a script tag with the same URL already exists, this resolves
 * immediately (no double-injection). If `globalCheck` is provided and returns
 * true, this resolves immediately even without an existing tag.
 *
 * @throws ScriptLoadError on failure or timeout.
 */
export function loadScript(options: LoadScriptOptions): Promise<void> {
  const {
    url,
    integrity,
    globalCheck,
    crossOrigin = 'anonymous',
    timeoutMs = 15000,
  } = options;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new ScriptLoadError(url, 'loadScript called outside of a browser environment')
    );
  }

  if (globalCheck && globalCheck()) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-commercehub-loaded="${cssEscape(url)}"]`
  );
  if (existing) {
    return waitForGlobal(globalCheck, timeoutMs, url);
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.crossOrigin = crossOrigin;
    if (integrity) {
      script.integrity = integrity;
    }
    script.dataset.commercehubLoaded = url;

    const timer = window.setTimeout(() => {
      script.remove();
      reject(new ScriptLoadError(url, `timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      if (globalCheck && !globalCheck()) {
        reject(new ScriptLoadError(url, 'script loaded but global check failed'));
        return;
      }
      resolve();
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new ScriptLoadError(url, 'network or CORS error'));
    });

    document.head.appendChild(script);
  });
}

function waitForGlobal(
  globalCheck: (() => boolean) | undefined,
  timeoutMs: number,
  url: string
): Promise<void> {
  if (!globalCheck) return Promise.resolve();
  if (globalCheck()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (globalCheck()) {
        window.clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        window.clearInterval(interval);
        reject(new ScriptLoadError(url, `global check timed out after ${timeoutMs}ms`));
      }
    }, 50);
  });
}

/** Minimal CSS attribute selector escape for our internal use. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
