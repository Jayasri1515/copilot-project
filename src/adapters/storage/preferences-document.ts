import { addFavorite, defaultPreferences } from '../../application/favorites';
import type { PreferencesDocument } from '../../domain/models';
import { validatePreferencesContract } from '../../domain/validation/contracts';
import {
  isWithinUtf8Limit,
  VALIDATION_LIMITS,
} from '../../domain/validation/limits';

const envelopeKeys = new Set(['version', 'unit', 'favorites']);

export interface DeserializedPreferences {
  readonly document: PreferencesDocument;
  readonly notices: readonly string[];
  readonly complete: boolean;
}

function safeDocument(notice?: string): DeserializedPreferences {
  return {
    document: defaultPreferences(),
    notices: notice ? Object.freeze([notice]) : Object.freeze([]),
    complete: notice === undefined,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Recovers a schema-v1 document at its independently-validatable boundaries.
 * Envelope failures are not salvaged; unit and favorite failures are isolated.
 */
export function deserializePreferences(
  body: string | null,
): DeserializedPreferences {
  if (body === null) return safeDocument();
  if (
    !isWithinUtf8Limit(body, VALIDATION_LIMITS.storageDocumentBytes)
  ) {
    return safeDocument('preferences_document_reset');
  }

  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    return safeDocument('preferences_document_reset');
  }
  if (
    !isPlainRecord(value) ||
    !Object.keys(value).every((key) => envelopeKeys.has(key)) ||
    value.version !== 1 ||
    !Array.isArray(value.favorites)
  ) {
    return safeDocument('preferences_document_reset');
  }

  const notices: string[] = [];
  const unit =
    value.unit === 'celsius' || value.unit === 'fahrenheit'
      ? value.unit
      : (notices.push('preferences_unit_reset'), 'celsius');
  let document: PreferencesDocument = Object.freeze({
    version: 1,
    unit,
    favorites: Object.freeze([]),
  });
  value.favorites.forEach((favorite, index) => {
    const validation = validatePreferencesContract({
      version: 1,
      unit,
      favorites: [favorite],
    });
    if (!validation.valid) {
      notices.push(`favorite_${index}_reset`);
      return;
    }
    document = addFavorite(document, validation.value.favorites[0]);
  });
  return {
    document,
    notices: Object.freeze(notices),
    complete: notices.length === 0,
  };
}

export function serializePreferences(document: PreferencesDocument): string {
  const favorites = document.favorites.map((favorite) => ({
    namespace: favorite.identity.namespace,
    ...(favorite.identity.namespace === 'open-meteo-search'
      ? { providerId: favorite.identity.providerId }
      : {}),
    latitude: favorite.identity.latitude.decimal,
    longitude: favorite.identity.longitude.decimal,
    city: favorite.city,
    administrativeRegion: favorite.administrativeRegion,
    country: favorite.country,
  }));
  const body = JSON.stringify({
    version: 1,
    unit: document.unit,
    favorites,
  });
  if (!isWithinUtf8Limit(body, VALIDATION_LIMITS.storageDocumentBytes)) {
    throw new RangeError('Preferences document exceeds the UTF-8 storage limit');
  }
  const validation = validatePreferencesContract(JSON.parse(body) as unknown);
  if (!validation.valid) throw new TypeError('Invalid preferences document');
  return body;
}
