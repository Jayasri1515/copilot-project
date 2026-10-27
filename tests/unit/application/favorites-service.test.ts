import { describe, expect, it } from 'vitest';
import { FavoritesPreferencesService } from '../../../src/application/favorites';
import type { LocalRepositoryPort } from '../../../src/application/ports';
import { operationError } from '../../../src/domain/errors';
import type { PreferencesDocument } from '../../../src/domain/models';
import type { PortResult } from '../../../src/domain/models/results';

const initial: PreferencesDocument = Object.freeze({
  version: 1,
  unit: 'celsius',
  favorites: Object.freeze([]),
});

describe('FavoritesPreferencesService', () => {
  it('does not publish an unconfirmed unit write', async () => {
    const repository: LocalRepositoryPort = {
      load: async () => ({ kind: 'success', value: initial, metadata: {} }),
      replace: async () => ({
        kind: 'failure',
        error: operationError('storage', false, 'storage_unavailable'),
      }),
      subscribe: () => () => undefined,
    };
    const service = new FavoritesPreferencesService(repository);
    await service.initialize();
    expect(await service.setUnit('fahrenheit')).toBe(false);
    expect(service.state.document.unit).toBe('celsius');
    expect(service.state.error?.category).toBe('storage');
  });

  it('applies valid external documents in delivery order', async () => {
    let listener: ((document: PreferencesDocument) => void) | undefined;
    const repository: LocalRepositoryPort = {
      load: async () => ({ kind: 'success', value: initial, metadata: {} }),
      replace: async (document) =>
        ({ kind: 'success', value: document, metadata: {} }) as PortResult<PreferencesDocument>,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    };
    const service = new FavoritesPreferencesService(repository);
    await service.initialize();
    listener?.({ ...initial, unit: 'fahrenheit' });
    listener?.(initial);
    expect(service.state.document.unit).toBe('celsius');
  });
});
