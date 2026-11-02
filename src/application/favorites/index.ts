import {
  canonicalIdentity,
  identityRelationship,
  type LocationIdentity,
} from '../../domain/identity';
import type {
  Favorite,
  PreferencesDocument,
  UnitPreference,
} from '../../domain/models';
import type { LocalRepositoryPort } from '../ports';
import { operationError, type OperationError } from '../../domain/errors';

export const defaultPreferences = (): PreferencesDocument =>
  Object.freeze({
    version: 1,
    unit: 'celsius',
    favorites: Object.freeze([]),
  });

function freezeFavorite(favorite: Favorite): Favorite {
  return Object.freeze({
    identity: favorite.identity,
    city: favorite.city,
    administrativeRegion: favorite.administrativeRegion,
    country: favorite.country,
  });
}

function documentWith(
  document: PreferencesDocument,
  favorites: readonly Favorite[],
  unit: UnitPreference = document.unit,
): PreferencesDocument {
  return Object.freeze({
    version: 1,
    unit,
    favorites: Object.freeze(favorites.map(freezeFavorite)),
  });
}

export function addFavorite(
  document: PreferencesDocument,
  candidate: Favorite,
): PreferencesDocument {
  const index = document.favorites.findIndex(
    ({ identity }) =>
      identityRelationship(identity, candidate.identity) !== 'distinct',
  );
  if (index < 0) {
    return documentWith(document, [...document.favorites, candidate]);
  }
  if (
    canonicalIdentity(document.favorites[index].identity) ===
    canonicalIdentity(candidate.identity)
  ) {
    return document;
  }
  const favorites = [...document.favorites];
  favorites[index] = candidate;
  return documentWith(document, favorites);
}

export function removeFavorite(
  document: PreferencesDocument,
  identity: LocationIdentity,
): PreferencesDocument {
  const key = canonicalIdentity(identity);
  const favorites = document.favorites.filter(
    (favorite) => canonicalIdentity(favorite.identity) !== key,
  );
  return favorites.length === document.favorites.length
    ? document
    : documentWith(document, favorites);
}

export function clearFavorites(
  document: PreferencesDocument,
): PreferencesDocument {
  return document.favorites.length === 0 ? document : documentWith(document, []);
}

export function selectUnit(
  document: PreferencesDocument,
  unit: UnitPreference,
): PreferencesDocument {
  return unit === document.unit
    ? document
    : documentWith(document, document.favorites, unit);
}

export interface PreferencesServiceState {
  readonly initialized: boolean;
  readonly document: PreferencesDocument;
  readonly warnings: readonly string[];
  readonly error?: OperationError;
}

export type PreferencesChangeSource = 'initial' | 'local' | 'external';

/**
 * Serializes whole-document writes and only publishes confirmed repository
 * state. This prevents a failed write from being presented as durable.
 */
export class FavoritesPreferencesService {
  readonly #repository: LocalRepositoryPort;
  readonly #listeners = new Set<
    (state: PreferencesServiceState, source: PreferencesChangeSource) => void
  >();
  #state: PreferencesServiceState = Object.freeze({
    initialized: false,
    document: defaultPreferences(),
    warnings: Object.freeze([]),
  });
  #writes: Promise<void> = Promise.resolve();
  #unsubscribe?: () => void;
  #suppressExternal = false;

  constructor(repository: LocalRepositoryPort) {
    this.#repository = repository;
  }

  get state(): PreferencesServiceState {
    return this.#state;
  }

  subscribe(
    listener: (
      state: PreferencesServiceState,
      source: PreferencesChangeSource,
    ) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize(): Promise<PreferencesServiceState> {
    if (this.#state.initialized) return this.#state;
    const result = await this.#safeLoad();
    if (result.kind === 'failure') {
      this.#state = Object.freeze({
        initialized: true,
        document: defaultPreferences(),
        warnings: Object.freeze([]),
        error: result.error,
      });
    } else {
      this.#state = Object.freeze({
        initialized: true,
        document: result.value,
        warnings: Object.freeze(
          result.kind === 'partial' ? [...result.unavailable] : [],
        ),
      });
    }
    this.#unsubscribe = this.#repository.subscribe((document) => {
      if (this.#suppressExternal) return;
      this.#state = Object.freeze({
        initialized: true,
        document,
        warnings: this.#state.warnings,
      });
      this.#emit('external');
    });
    this.#emit('initial');
    return this.#state;
  }

  setUnit(unit: UnitPreference): Promise<boolean> {
    return this.#mutate((document) => selectUnit(document, unit));
  }

  add(favorite: Favorite): Promise<boolean> {
    return this.#mutate((document) => addFavorite(document, favorite));
  }

  remove(identity: LocationIdentity): Promise<boolean> {
    return this.#mutate((document) => removeFavorite(document, identity));
  }

  clear(): Promise<boolean> {
    return this.#mutate(clearFavorites);
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }

  async #safeLoad() {
    try {
      return await this.#repository.load();
    } catch {
      return {
        kind: 'failure' as const,
        error: {
          category: 'storage' as const,
          retryable: false,
          messageKey: 'storage_unavailable' as const,
        },
      };
    }
  }

  #mutate(
    change: (document: PreferencesDocument) => PreferencesDocument,
  ): Promise<boolean> {
    let outcome = false;
    const operation = this.#writes.then(async () => {
      if (!this.#state.initialized) await this.initialize();
      const candidate = change(this.#state.document);
      if (candidate === this.#state.document) {
        outcome = true;
        return;
      }
      try {
        this.#suppressExternal = true;
        const result = await this.#repository.replace(candidate);
        if (result.kind === 'failure') {
          this.#state = Object.freeze({ ...this.#state, error: result.error });
        } else {
          this.#state = Object.freeze({
            initialized: true,
            document: result.value,
            warnings: Object.freeze([
              ...this.#state.warnings,
              ...(result.kind === 'partial' ? result.unavailable : []),
            ]),
          });
          outcome = true;
        }
      } catch {
        this.#state = Object.freeze({
          ...this.#state,
          error: operationError('storage', false, 'storage_unavailable'),
        });
      } finally {
        this.#suppressExternal = false;
        this.#emit('local');
      }
    });
    this.#writes = operation.catch(() => undefined);
    return operation.then(() => outcome);
  }

  #emit(source: PreferencesChangeSource): void {
    for (const listener of this.#listeners) listener(this.#state, source);
  }
}
