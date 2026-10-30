# Open-Meteo and storage contract boundary

This document records the deterministic contract implemented by T-020. It
does not add fields or semantics to the approved requirements and
architecture. Routine tests use only committed local fixtures and never call
Open-Meteo.

## Trust and size boundaries

- Geocoding and weather bodies are measured as UTF-8 before JSON decoding.
  Bodies through 1,048,576 bytes are eligible for decoding; larger bodies are
  rejected.
- The favorites/preferences JSON document is measured as UTF-8 before
  decoding or writing. Documents through 262,144 bytes are eligible; larger
  documents are rejected.
- Malformed JSON, wrong required-field types, missing required structures,
  excessive arrays, non-finite numbers, and out-of-range values are rejected
  without coercion. Unknown provider fields alone are ignored.
- Accepted strings contain at most 200 Unicode code points. Geocoding has at
  most 20 returned entries and each weather daily array has at most 16.

## Geocoding response

The response is an object. An absent `results` member is the documented empty
result. When present, `results` is an array. A selectable entry requires a
positive safe-integer `id`, non-empty `name`, and finite `latitude` and
`longitude` in `[-90,90]` and `[-180,180]`. Optional `admin1`, `country`,
`timezone`, and `elevation` are either the documented type or null/absent.
Invalid candidates are isolated; region and country absence does not reject a
candidate. A response with over 20 entries is rejected as a whole.

## Weather response

The response requires validated `latitude`, `longitude`, non-empty `timezone`,
`elevation`, and object members `current`, `current_units`, `daily`, and
`daily_units`. The selected temperature unit must exactly match `°C` or `°F`;
humidity is `%` and weather-code units are `wmo code`.

Current temperature, humidity, and weather code may be null/absent and become
explicitly unavailable. Present values must have the required type and range.
Daily `time`, `weather_code`, `temperature_2m_max`, and
`temperature_2m_min` arrays are required, aligned, and independently limited
to 16. Daily semantic date processing is intentionally deferred to T-030.

Numeric bounds are Celsius `[-100,70]`, Fahrenheit `[-148,158]`, humidity
`[0,100]`, elevation metres `[-500,9000]`, and integer WMO code `[0,99]`.

## Identity and precision

Search identities use `open-meteo-search`, a valid provider ID, and both
coordinates. Device identities use `device-coordinates` and coordinates but
no provider ID. Coordinates retain a canonical decimal representation and
the exact JavaScript numeric value accepted at the boundary; no application
rounding is performed. Stored coordinates are decimal strings so JSON
round-trips do not change the identity representation.

## Conditions and safe errors

`src/domain/conditions/index.ts` is the exhaustive approved WMO semantic
table from requirements Section 7.1. Any other valid integer from 0 through
99 maps to **Unknown conditions** and `unknown`. Values outside that range or
non-integers are invalid. Semantic icon keys identify bundled local assets;
they are never URLs.

Ports expose `success`, `partial`, or `failure`. Failures contain only a
closed error category, retryability, a closed user-safe message key, and an
optional validated retry delay. Raw payloads and arbitrary provider messages
are not part of this result.

## Storage schema v1 fixture shape

The strict envelope is:

```json
{"version":1,"unit":"celsius","favorites":[]}
```

Favorites contain only `namespace`, optional search `providerId`, decimal
string `latitude` and `longitude`, `city`, nullable
`administrativeRegion`, and nullable `country`. Unexpected envelope or
favorite fields are rejected. Schema-v1 per-entry isolation and recovery are
implemented by T-050; T-020's strict validator identifies invalid entries
without accepting or coercing them.
