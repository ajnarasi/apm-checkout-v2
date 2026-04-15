/**
 * Typed ordered event bus.
 *
 * Ported from v1 `checkout-sdk/src/core/event-bus.ts` — kept verbatim.
 * The only caller is BaseAdapter via the `emit()` helper, so we
 * centralize listener management and ordering guarantees here.
 */

export type EventListener<T> = (event: T) => void | Promise<void>;

export class EventBus<T extends { type: string }> {
  private readonly listeners = new Map<string, Set<EventListener<T>>>();
  private readonly allListeners = new Set<EventListener<T>>();

  on(type: string, listener: EventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  onAny(listener: EventListener<T>): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  async emit(event: T): Promise<void> {
    const specific = this.listeners.get(event.type);
    const listeners: EventListener<T>[] = [];
    if (specific) listeners.push(...specific);
    listeners.push(...this.allListeners);

    for (const l of listeners) {
      try {
        await l(event);
      } catch (err) {
        // Listener errors must NOT prevent other listeners from running
        // eslint-disable-next-line no-console
        console.error('[EventBus] listener error', err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.allListeners.clear();
  }
}
