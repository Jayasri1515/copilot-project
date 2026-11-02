import type { LocalRepositoryPort } from '../../application/ports';
import type { PreferencesDocument } from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
import { validatePreferencesContract } from '../../domain/validation/contracts';
import { operationError } from '../../domain/errors';
import {
  deserializePreferences,
  serializePreferences,
} from './preferences-document';

const metadata = Object.freeze({});

export class MemoryPreferencesRepository implements LocalRepositoryPort {
  private document: PreferencesDocument;
  private readonly listeners = new Set<(document: PreferencesDocument) => void>();

  constructor(initial?: PreferencesDocument) {
    this.document = initial
      ? this.validatedCopy(initial) ?? deserializePreferences(null).document
      : deserializePreferences(null).document;
  }

  async load(): Promise<PortResult<PreferencesDocument>> {
    return { kind: 'success', value: this.document, metadata };
  }

  async replace(
    document: PreferencesDocument,
  ): Promise<PortResult<PreferencesDocument>> {
    const next = this.validatedCopy(document);
    if (!next) {
      return {
        kind: 'failure',
        error: operationError('storage', false, 'storage_unavailable'),
      };
    }
    this.document = next;
    for (const listener of this.listeners) listener(next);
    return { kind: 'success', value: next, metadata };
  }

  subscribe(listener: (document: PreferencesDocument) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private validatedCopy(
    document: PreferencesDocument,
  ): PreferencesDocument | undefined {
    try {
      const serialized = serializePreferences(document);
      const parsed = JSON.parse(serialized) as unknown;
      const result = validatePreferencesContract(parsed);
      return result.valid ? result.value : undefined;
    } catch {
      return undefined;
    }
  }
}
