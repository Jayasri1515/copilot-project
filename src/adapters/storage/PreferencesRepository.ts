import type { LocalRepositoryPort } from '../../application/ports';
import { operationError } from '../../domain/errors';
import type { PreferencesDocument } from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
import { MemoryPreferencesRepository } from './MemoryPreferencesRepository';
import {
  deserializePreferences,
  serializePreferences,
} from './preferences-document';

export const PREFERENCES_STORAGE_KEY = 'weather-browser.preferences.v1';
export const SESSION_STORAGE_WARNING = 'persistent_storage_unavailable';

type StorageEventSource = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
>;

export interface PreferencesRepositoryOptions {
  readonly storage?: Storage;
  readonly eventSource?: StorageEventSource;
  readonly key?: string;
}

const metadata = Object.freeze({});
const storageFailure = () => ({
  kind: 'failure' as const,
  error: operationError('storage', false, 'storage_unavailable'),
});

export class PreferencesRepository implements LocalRepositoryPort {
  private readonly key: string;
  private storage: Storage | undefined;
  private readonly eventSource: StorageEventSource | undefined;
  private readonly memory = new MemoryPreferencesRepository();
  private fallback = false;
  private document = deserializePreferences(null).document;
  private readonly listeners = new Set<(document: PreferencesDocument) => void>();
  private listening = false;

  constructor(options: PreferencesRepositoryOptions = {}) {
    this.key = options.key ?? PREFERENCES_STORAGE_KEY;
    this.eventSource =
      options.eventSource ?? (typeof window === 'undefined' ? undefined : window);
    if (options.storage) {
      this.storage = options.storage;
    } else {
      try {
        this.storage =
          typeof window === 'undefined' ? undefined : window.localStorage;
      } catch {
        this.activateFallback();
      }
    }
    if (!this.storage) this.activateFallback();
  }

  async load(): Promise<PortResult<PreferencesDocument>> {
    if (this.fallback) return this.memoryResult(await this.memory.load());
    let body: string | null;
    try {
      body = this.storage!.getItem(this.key);
    } catch {
      this.activateFallback();
      return this.memoryResult(await this.memory.load());
    }
    // Some private-mode implementations permit reads but reject every write.
    // Probe only when no durable preferences exist; an existing document must
    // remain authoritative and later write failures must not switch modes.
    if (body === null && !this.storageIsWritable()) {
      this.activateFallback();
      return this.memoryResult(await this.memory.load());
    }
    const loaded = deserializePreferences(body);
    this.document = loaded.document;
    return loaded.notices.length
      ? {
          kind: 'partial',
          value: loaded.document,
          unavailable: loaded.notices,
          metadata,
        }
      : { kind: 'success', value: loaded.document, metadata };
  }

  async replace(
    document: PreferencesDocument,
  ): Promise<PortResult<PreferencesDocument>> {
    if (this.fallback) {
      return this.memoryResult(await this.memory.replace(document));
    }
    let body: string;
    try {
      body = serializePreferences(document);
      this.storage!.setItem(this.key, body);
      if (this.storage!.getItem(this.key) !== body) return storageFailure();
    } catch {
      return storageFailure();
    }
    const confirmed = deserializePreferences(body);
    if (!confirmed.complete) return storageFailure();
    this.document = confirmed.document;
    return { kind: 'success', value: this.document, metadata };
  }

  subscribe(listener: (document: PreferencesDocument) => void): () => void {
    this.listeners.add(listener);
    if (!this.listening && !this.fallback && this.eventSource) {
      this.eventSource.addEventListener('storage', this.onStorage);
      this.listening = true;
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.listening && this.eventSource) {
        this.eventSource.removeEventListener('storage', this.onStorage);
        this.listening = false;
      }
    };
  }

  private readonly onStorage = (event: Event): void => {
    const storageEvent = event as StorageEvent;
    if (
      this.fallback ||
      storageEvent.key !== this.key ||
      (storageEvent.storageArea !== null &&
        storageEvent.storageArea !== this.storage)
    ) {
      return;
    }
    const incoming = deserializePreferences(storageEvent.newValue);
    if (!incoming.complete || storageEvent.newValue === null) return;
    this.document = incoming.document;
    for (const listener of this.listeners) listener(this.document);
  };

  private activateFallback(): void {
    this.fallback = true;
    this.storage = undefined;
    if (this.listening && this.eventSource) {
      this.eventSource.removeEventListener('storage', this.onStorage);
      this.listening = false;
    }
  }

  private storageIsWritable(): boolean {
    const probeKey = `${this.key}.availability-probe`;
    try {
      const previous = this.storage!.getItem(probeKey);
      const probeValue = previous ?? '1';
      this.storage!.setItem(probeKey, probeValue);
      if (this.storage!.getItem(probeKey) !== probeValue) return false;
      if (previous === null) this.storage!.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  private memoryResult(
    result: PortResult<PreferencesDocument>,
  ): PortResult<PreferencesDocument> {
    if (result.kind === 'failure') return result;
    this.document = result.value;
    return {
      kind: 'partial',
      value: result.value,
      unavailable: Object.freeze([
        SESSION_STORAGE_WARNING,
        ...(result.kind === 'partial' ? result.unavailable : []),
      ]),
      metadata,
    };
  }
}
