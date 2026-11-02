export const BUDGET_CHANNEL_NAME = 'weather-browser.request-budget.v1';

type MessageListener = (event: MessageEvent<unknown>) => void;

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: 'message', listener: MessageListener): void;
  close(): void;
}

export type BroadcastChannelFactory = (
  name: string,
) => BroadcastChannelLike;

const notification = Object.freeze({
  type: 'request-budget-changed',
  version: 1,
});

export class BroadcastBudgetChannel {
  private readonly channel?: BroadcastChannelLike;
  private readonly listeners = new Set<() => void>();

  constructor(factory?: BroadcastChannelFactory) {
    const selectedFactory = factory ?? (
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : (name: string) => new BroadcastChannel(name)
    );
    try {
      this.channel = selectedFactory?.(BUDGET_CHANNEL_NAME);
      this.channel?.addEventListener('message', this.onMessage);
    } catch {
      this.channel = undefined;
    }
  }

  publish(): void {
    try {
      this.channel?.postMessage(notification);
    } catch {
      // Durable localStorage remains authoritative; notification is advisory.
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.channel?.removeEventListener('message', this.onMessage);
    this.channel?.close();
    this.listeners.clear();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data;
    if (
      typeof message !== 'object' ||
      message === null ||
      (message as Record<string, unknown>).type !== notification.type ||
      (message as Record<string, unknown>).version !== notification.version
    ) {
      return;
    }
    for (const listener of this.listeners) listener();
  };
}
