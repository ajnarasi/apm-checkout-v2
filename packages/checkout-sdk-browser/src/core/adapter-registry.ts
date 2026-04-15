/**
 * Adapter registry. Ported verbatim from v1.
 *
 * Adapters self-register via `register-all.ts` at import time.
 * CheckoutManager looks up adapters by id at `createCheckout()` time.
 */

import type { APMAdapter } from './types.js';

export type AdapterFactory = () => APMAdapter;

const registry = new Map<string, AdapterFactory>();

export function registerAdapter(id: string, factory: AdapterFactory): void {
  if (registry.has(id)) {
    // eslint-disable-next-line no-console
    console.warn(`[AdapterRegistry] adapter "${id}" is being re-registered`);
  }
  registry.set(id, factory);
}

export function getAdapter(id: string): APMAdapter {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `[AdapterRegistry] no adapter registered for "${id}". ` +
        `Known adapters: ${[...registry.keys()].join(', ') || '(none)'}`
    );
  }
  return factory();
}

export function listAdapterIds(): string[] {
  return [...registry.keys()].sort();
}

export function clearRegistry(): void {
  registry.clear();
}

export function hasAdapter(id: string): boolean {
  return registry.has(id);
}
