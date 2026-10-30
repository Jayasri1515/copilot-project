# Weather Application Requirements

## 1. Document Control and Approval Gate

| Item | Value |
|---|---|
| SDLC stage | Requirements revision following Stage 3 design review |
| Authoritative artifact | Repository-root `requirements.md` |
| Original source | [`.github/input/userstory.md`](./.github/input/userstory.md), US-001 through US-007 |
| Correction sources | User-approved selections provided on 2026-10-27 in response to `design-review.md`; user-approved product and quality decisions for implementation-plan blockers B-003 through B-016, supplied 2026-10-27 |
| Supersedes | Requirements baseline approved on 2026-10-27 |
| Revised requirements status | **Approved by the user on 2026-10-27** |
| Production implementation authorized | No |
| Next stage authorized | Stage 4 implementation-plan revision and review |

This revision incorporates the supplied corrections and the requirements-level
decisions for blockers B-003 through B-016. Those decisions are approved user
inputs dated 2026-10-27. It does not approve implementation or silently decide
the remaining implementation, security, or deployment choices. An unavailable
fact is recorded exactly as **Not Found**.

## 2. Purpose, Scope, and Product Boundary

The product shall be a browser-based single-page application (SPA) that lets a
user search for weather by city, explicitly request weather for the device
location, view current conditions and a three-day forecast, refresh weather
data, save and manage favorite locations, select a temperature unit, and use
the interface across desktop and mobile screen sizes.

The SPA shall integrate directly from the browser with the Open-Meteo weather
and geocoding APIs. This integration requires no confidential API key. A
backend-for-frontend is not part of the selected product boundary.
The approved deployment scope is non-commercial use of Open-Meteo's free API.
The UI shall provide the attribution required by Open-Meteo's data licence.

Accounts, cross-device synchronization, notifications, maps, historical
weather, and administrative functions are **Not Found**.

## 3. Actors and External Dependencies

| Actor or dependency | Responsibility |
|---|---|
| User | Searches, chooses an ambiguous search result, requests device location, views weather, selects units, refreshes or retries, and manages favorites. |
| Browser SPA | Presents the interface, coordinates API requests, validates data, and persists favorites and preferences locally. |
| Browser geolocation service | Supplies device coordinates after the user explicitly selects **Use my location** and completes the browser permission flow. |
| Open-Meteo geocoding API | Resolves name-based city searches into candidate locations. It is not used as an assumed reverse-geocoding service. |
| Open-Meteo weather API | Supplies current weather, forecast data, and location-timezone data needed by the selected forecast-day rule. |
| Browser `localStorage` | Stores favorites/preferences schema v1 and coordinates request-budget and cross-tab document state in the current browser profile. |
| Browser `BroadcastChannel` | Coordinates the shared request budget between active same-origin tabs when available; `localStorage` remains the durable coordination source. |

The selected geocoding contract is `GET
https://geocoding-api.open-meteo.com/v1/search` with `name`, `count`,
`language`, and `format=json`. Candidate fields used by the SPA are `id`,
`name`, `latitude`, `longitude`, `timezone`, `country`, and `admin1`.

The selected weather contract is `GET
https://api.open-meteo.com/v1/forecast` with `latitude`, `longitude`,
`current=temperature_2m,relative_humidity_2m,weather_code`,
`daily=weather_code,temperature_2m_max,temperature_2m_min`,
`temperature_unit`, `timezone=auto`, and enough forecast days to include today
plus the next three location-local dates. The SPA uses the response timezone,
current values and units, and aligned daily time/value arrays.

Browser access was verified through successful responses carrying
`Access-Control-Allow-Origin: *`. The free API is limited to non-commercial
use, 10,000 calls per day, 5,000 per hour, and 600 per minute, has no uptime
guarantee, and requires attribution under CC BY 4.0.
The supported browser baseline is the latest two major versions of Chrome,
Edge, Firefox, and Safari. The application is online-only and has no service
worker or weather cache.

## 4. Functional Requirements

### FR-001: Search for and select a city

1. The system shall accept a city name submitted by the user.
2. The system shall trim the submitted value and, when it is empty, prompt the
   user to enter a city name without sending a geocoding request.
3. The system shall use the Open-Meteo geocoding API to resolve a non-empty
   city search.
4. If the search identifies one location, the system shall select that
   location and request its weather.
5. If the search is ambiguous, the system shall show a selectable candidate
   list that identifies each candidate by city, administrative region, and
   country.
6. The system shall not request weather for an ambiguous search until the user
   selects a candidate.
7. After a candidate is selected, the system shall display weather for that
   selected location and shall display its city, administrative region, and
   country.
8. If a location field required for the candidate list is absent in an
   Open-Meteo response, the system shall identify that field as unavailable
   rather than fabricate it. A candidate remains selectable when
   administrative region or country is absent, but not when city/name is
   absent.
9. If no city is found, the system shall display a clear city-not-found
   message.
10. If geocoding or weather service access fails, the system shall display an
    appropriate error without crashing.
11. A candidate shall be accepted only when it has a non-empty city/name, a
    valid Open-Meteo location ID, and finite latitude and longitude within
    their valid ranges. Missing administrative region or country shall not
    invalidate it.
12. No more than 20 validated geocoding results shall be accepted or
    displayed from one response.

### FR-002: Use device location only on explicit request

1. The system shall provide a **Use my location** action.
2. The system shall not request browser geolocation when the SPA opens or
   before the user explicitly selects **Use my location**.
3. When the user selects **Use my location**, the system shall use the browser
   permission mechanism before accessing location data.
4. When permission is granted and location access succeeds, the system shall
   resolve the coordinates and display corresponding weather.
5. If permission is denied, the system shall display an appropriate message
   and keep city search available.
6. If the location cannot be determined or the geolocation request times out,
   the system shall display a helpful error and keep city search available.
7. The geolocation request shall time out after 10 seconds. On timeout, the
   system shall show a helpful error and keep city search available.

### FR-003: Display current weather and manage temperature units

1. For a selected valid location, the system shall display current
   temperature, humidity, and weather condition when available.
2. The system shall display a suitable icon representing the current
   condition.
3. The supported temperature-unit choices shall be Celsius and Fahrenheit.
4. Celsius shall be the default when no valid persisted unit preference
   exists.
5. The user shall be able to switch between Celsius and Fahrenheit.
6. The system shall persist the selected unit in the versioned
   favorites/preferences schema in browser `localStorage`.
7. On a unit change, the system shall refetch weather for the selected
   location in the newly selected unit; it shall not relabel the previously
   displayed numeric temperature as though it were newly fetched data.
8. Displayed temperatures shall include the selected unit.
9. When current-weather data is incomplete, the system shall display
   available values and clearly identify unavailable values.
10. If current weather cannot be retrieved, the system shall display an
    appropriate error or retry message.
11. Displayed current and forecast temperatures shall be rounded to the
    nearest whole degree.
12. A temperature exactly halfway between two whole degrees shall be rounded
    away from zero.
13. Every documented Open-Meteo WMO weather code shall map to the description
    and semantic icon key in Section 7.1. An unrecognized otherwise-valid
    code shall display **Unknown conditions** with the `unknown` icon key.
14. Condition icons shall be bundled local SVG assets. The SPA shall not
    retrieve condition icons from an external runtime source.

### FR-004: Display the next three forecast days

1. For a selected valid location, the system shall display up to the next
   three forecast days when data is available.
2. “Next three forecast days” shall mean the three calendar dates immediately
   after today in the selected location's timezone; today in that timezone
   shall be excluded.
3. Each forecast day shall show its date, daily high and daily low
   temperatures in the selected unit, expected weather condition, and a
   suitable icon.
4. If fewer than three qualifying forecast days are returned, the system shall
   show the available qualifying days and indicate that the remaining data is
   unavailable without fabricating forecast records.
5. If forecast retrieval fails, the system shall display an appropriate error
   and provide a retry option.
6. Forecast records shall be validated, sorted by date, and deduplicated
   before display. Malformed records shall be rejected while remaining valid
   days are displayed.
7. If the selected location's timezone is unavailable, the forecast shall be
   shown as unavailable rather than using the device timezone or UTC.
8. Daily arrays shall contain no more than 16 elements. Aligned records that
   are identical for the same date shall collapse to one record. If duplicate
   records for a date differ in any forecast value, the conflicting records
   for that date shall be rejected and that date shall be unavailable; values
   shall not be merged or selected arbitrarily.

### FR-005: Refresh, retry, and network timing

1. The system shall provide a manual refresh action for displayed weather.
2. Refresh shall request the latest available current weather and forecast for
   the selected location in the selected unit.
3. A successful refresh shall update current weather and forecast details.
4. The system shall prevent duplicate in-flight refresh requests or otherwise
   handle concurrent refresh actions safely.
5. On refresh failure, the system shall display an appropriate message and
   retain previously loaded data when available, identifying retained data as
   stale.
6. After each successful application retrieval, the system shall display the
   retrieval time in the selected location's timezone. It shall not represent
   that value as provider observation time.
7. Each Open-Meteo weather or geocoding network request shall time out after
   10 seconds.
8. The system shall make no more than one automatic retry after a transient
   network or provider failure.
9. The system shall honor an applicable provider `Retry-After` response before
   making an automatic or manual retry.
10. After a manual retry is initiated, the system shall prevent another manual
    retry from being initiated for 1 second.
11. The 10-second timeout applies per attempt. Network failures, timeout,
    HTTP 408, HTTP 429, and HTTP 5xx are transient; other HTTP 4xx responses
    and validation failures are not. When `Retry-After` is absent or invalid,
    the one automatic retry shall use jitter from 250 through 1,000
    milliseconds. A valid `Retry-After` longer than 10 seconds shall end the
    active operation while preserving the full retry embargo.
12. The product is online-only. It shall not install a service worker or
    retain a weather-response cache. When offline, it shall preserve usable
    local controls and display that live weather requires a connection.
13. Across tabs in one browser profile and origin, the SPA shall enforce an
    application request budget of no more than 500 Open-Meteo requests per
    day and 100 per hour, coordinated through
    `localStorage` and `BroadcastChannel`. Provider limits and an applicable
    `Retry-After` remain authoritative when stricter. Attempts blocked before
    dispatch do not count as provider requests. These limits use rolling
    60-minute and rolling 24-hour windows.

### FR-006: Manage favorite locations and local preferences

1. The user shall be able to save a successfully resolved location as a
   favorite.
2. The system shall display saved locations in a favorites section.
3. Selecting a favorite shall request and display current weather and forecast
   for that location in the selected unit.
4. A search-selected favorite identity shall combine the Open-Meteo location
   ID and provider-returned coordinates. A device-location favorite shall use
   a `device-coordinates` namespace plus the validated browser coordinates.
5. Adding a favorite whose identity matches an existing favorite shall not
   create a duplicate.
6. The user shall be able to remove one favorite.
7. The user shall be able to clear all favorites.
8. Favorites and the temperature-unit preference shall be persisted in
   browser `localStorage` using a versioned schema.
9. A persisted favorite shall contain only the minimal location fields needed
   to restore identity, display the location, and request its weather:
   identity namespace, optional Open-Meteo location ID, coordinates, city,
   administrative region, and country.
10. Weather observations, forecasts, device-permission state, and search
    history shall not be stored as favorite fields.
11. Favorites shall remain available after reopening the SPA in the same
    browser profile unless the user clears favorites, the browser/site data is
    cleared, or `localStorage` is unavailable. The selected unit shall remain
    available after reopening unless the browser/site data is cleared or
    `localStorage` is unavailable.
12. Clear-all shall remove all favorites and preserve the selected
    temperature-unit preference.
13. Coordinates shall be stored at the precision returned by Open-Meteo.
14. The current favorites/preferences storage schema version shall be `1`.
    No legacy versions are recognized initially. Invalid v1 entries shall be
    reset individually while valid v1 entries are retained, and the user
    shall be notified. Corrupt JSON and unsupported future versions shall not
    be interpreted as v1 or migrated by inference.
15. A search result without an Open-Meteo location ID shall be rejected as an
    invalid candidate. Device locations do not require an Open-Meteo location
    ID.
16. If a later name search returns a changed Open-Meteo location ID at exactly
    matching provider-precision coordinates, the stored search identity shall
    be migrated to the new ID instead of creating a duplicate.
17. When `localStorage` is unavailable or inaccessible, the SPA shall continue
    with a session-memory repository and show a persistent warning that
    changes will not survive the session.
18. If a quota or write failure occurs after a previously stored document
    exists, that last confirmed stored document shall remain authoritative;
    the SPA shall report that the attempted change was not saved and shall
    not claim durable success.
19. Same-origin tabs shall process `storage` events using
    latest-document-wins. Each complete valid document replaces in-memory
    favorites/preferences in browser event-delivery order, so the last valid
    delivered document wins. Invalid documents do not replace valid state.
20. Test fixtures shall include a valid schema-v1 document, mixed valid and
    invalid entries, corrupt JSON, and an unsupported future version.

### FR-007: Provide a clear responsive interface

1. The system shall present available weather information in a clear,
   organized, easy-to-read layout.
2. Conditions shall have suitable icons and descriptive text.
3. Temperature, humidity, and forecast values shall have identifiable labels
   and appropriate units.
4. The layout shall adjust appropriately for desktop and mobile screen sizes.
5. Loading, unavailable-data, stale-data, rate-limit, timeout, and error states
   shall show a loading indicator, helpful message, or error state rather than
   misleading information.
6. Navigation among search results, candidate selection, current weather,
   forecasts, and favorites shall provide clear controls and consistent
   navigation.
7. During a required `Retry-After` wait or the 1-second manual retry cooldown,
   the interface shall prevent the disallowed retry.
8. The responsive layout shall remain usable from 320 CSS pixels through
   1440 CSS pixels and wider.
9. All functionality shall be operable by keyboard and shall expose native or
   equivalent programmatic names, roles, values, relationships, focus order,
   focus visibility, and status/error announcements to screen readers.
10. The English-language UI shall format dates and numbers using the user's
    locale while retaining the approved location-timezone and unit semantics.
11. The SPA shall provide a concise notice explaining that explicit
    geolocation may disclose coordinates to Open-Meteo and that favorites and
    preferences use local browser storage.

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 | The SPA shall not crash when Open-Meteo, geolocation, or `localStorage` is unavailable or a request fails. |
| NFR-002 | User-facing errors, stale states, waits, and unavailable values shall be clear and understandable. |
| NFR-003 | The interface shall be responsive and usable at viewport widths from 320 CSS pixels through 1440 CSS pixels and wider. |
| NFR-004 | User input, Open-Meteo responses, geolocation results, and persisted data shall be validated before display or use. Each geocoding or weather response body shall be rejected if it exceeds 1 MiB (1,048,576 bytes); accepted strings shall contain at most 200 characters; geocoding results shall contain at most 20 entries; and each daily array shall contain at most 16 entries. Numeric values shall be finite and strictly range-validated: latitude -90 through 90 degrees, longitude -180 through 180 degrees, temperature -100 through 70 degrees Celsius or -148 through 158 degrees Fahrenheit, relative humidity 0 through 100 percent, elevation -500 through 9,000 metres, provider IDs as positive JavaScript-safe integers, and WMO weather codes 0 through 99. |
| NFR-005 | The SPA shall avoid unnecessary duplicate weather requests and shall enforce FR-005 retry limits. |
| NFR-006 | The SPA shall not contain or require a confidential Open-Meteo API key. |
| NFR-007 | Favorite and preference storage shall use schema v1 and shall contain only the fields permitted by FR-006. Each accepted stored string shall contain at most 200 characters. Serialized UTF-8 JSON exceeding 256 KiB shall be rejected. |
| NFR-008 | The UI shall meet WCAG 2.2 Level AA. It shall support keyboard-only operation and screen-reader semantics and announcements, and the latest two major versions of Chrome, Edge, Firefox, and Safari. The UI language is English; user-visible dates and numbers shall use locale-aware formatting. |
| NFR-009 | The deployed SPA shall remain within the documented free-API quotas, be used only for non-commercial purposes, and display required Open-Meteo attribution. |
| NFR-010 | At the 75th percentile of 20 cold Lighthouse CI mobile-profile runs using 4x CPU slowdown and 1.6 Mbps network throughput, Largest Contentful Paint shall be no more than 2.5 seconds, Interaction to Next Paint no more than 200 milliseconds, and Cumulative Layout Shift no more than 0.1. Acknowledgement or visible feedback for a user action shall begin within 100 milliseconds. |
| NFR-011 | Initial JavaScript transferred for first use shall be no more than 250 KiB gzip-compressed. Lazy-loaded JavaScript after initial use is outside this initial budget. |
| NFR-012 | The Cloudflare Pages deployment shall pass a five-minute k6 test at 100 virtual users with fewer than 1 percent failed static requests and p95 static response time below 500 milliseconds. Automated load verification shall not consume live Open-Meteo quota. |
| NFR-013 | No end-to-end availability SLA applies because the free Open-Meteo service provides none. The product shall not claim an availability guarantee. |
| NFR-014 | The SPA shall send no telemetry. Diagnostics shall remain in memory for the current browser session only, clear on reload or close, provide no support export, exclude raw provider payloads, search history, precise coordinates, favorites, and permission state, and shall not be transmitted. |
| NFR-015 | Valid favorites shall be retained until the user removes or clears them or the browser/site data is cleared. The SPA shall not expire valid favorites automatically; FR-006.14 still governs invalid persisted entries. |
| NFR-016 | Provider contract validation shall reject incompatible changes, including missing required fields, changed types, arrays beyond approved bounds, or values outside approved ranges. Unknown extra fields alone may be ignored after the known contract is validated. No incompatible provider or storage contract shall be accepted through coercion or inferred migration. |

## 6. Inputs and Outputs

### 6.1 Inputs

- City text and search submission.
- Ambiguous-city candidate selection.
- **Use my location** action and browser permission decision.
- Device coordinates, when granted and available.
- Celsius/Fahrenheit selection.
- Refresh and retry actions.
- Add-favorite, select-favorite, remove-one, and clear-all actions.
- Validated Open-Meteo geocoding and weather responses.
- Validated versioned favorites/preferences data from `localStorage`.

### 6.2 Outputs

- Search candidates identified by city, administrative region, and country.
- Selected location identity and display fields.
- Current temperature, humidity, condition, icon, and units.
- Up to three qualifying future forecast dates with temperature, condition,
  icon, and units.
- Loading, unavailable, stale, city-not-found, permission, geolocation,
  timeout, rate-limit, service, cooldown, and retry states or messages.
- Favorites list and persisted unit selection.
- Successful application retrieval time in the selected-location timezone.
- Persistent storage-fallback and write-failure warnings when applicable.
- Concise geolocation and local-storage notice.
- Shared request-budget exhausted state when dispatch would exceed 100
  requests/hour or 500 requests/day for the browser profile.

## 7. Business Rules and Edge Cases

| ID | Rule |
|---|---|
| BR-001 | Empty city input is rejected before an API request. |
| BR-002 | An unresolved ambiguous search is not treated as a selected location. |
| BR-003 | Unknown cities and missing values are not presented as successful or fabricated data. |
| BR-004 | Device geolocation begins only after the explicit user action. |
| BR-005 | Forecast day inclusion uses the selected location's timezone and excludes its current calendar date; no timezone fallback is inferred. |
| BR-006 | Missing forecast days are indicated and are not synthesized. |
| BR-007 | The selected unit applies to current weather, forecast, refresh, favorite selection, and subsequent requests. |
| BR-008 | A unit change causes a refetch and is persisted locally. |
| BR-009 | Search favorites use Open-Meteo ID plus provider-returned coordinates; device favorites use namespaced validated coordinates. Raw spelling and display names do not determine identity. A changed search ID migrates when provider-precision coordinates match exactly. |
| BR-010 | Remove-one affects only the chosen favorite; clear-all removes all favorites and preserves the selected unit preference. |
| BR-011 | A failed refresh retains available prior data and identifies it as stale. |
| BR-012 | No request may bypass an applicable `Retry-After`; manual retry is subject to the 1-second cooldown. |
| BR-013 | A late result for a previously selected location or unit shall not replace the currently selected location or unit's displayed data. |
| BR-014 | Identical records for one forecast date collapse to one record. Conflicting duplicates cause that date to be rejected; duplicate fields are not merged. |
| BR-015 | Exact half-degree temperatures round away from zero. |
| BR-016 | Missing administrative region or country does not make an otherwise valid candidate unselectable; missing city/name or invalid coordinates does. |
| BR-017 | A successful-update timestamp is the application retrieval time and is displayed in the selected location's timezone. |
| BR-018 | Schema v1 is the only initially recognized storage schema. An unsupported future version is not treated as a legacy version. |
| BR-019 | On storage writes, only confirmed successful replacement changes durable state. A failed write leaves the last confirmed stored document authoritative. |
| BR-020 | Cross-tab favorite/preference synchronization is latest-document-wins through `storage` events: valid complete documents are applied in delivery order and the last valid delivered document wins. |
| BR-021 | The browser-profile request budget is shared across same-origin tabs. The application budget never authorizes a request prohibited by an Open-Meteo limit or embargo. |

### 7.1 WMO condition and icon mapping

The descriptions below follow the Open-Meteo-documented WMO weather
interpretation codes. Each semantic key selects a bundled local SVG; it is not
an external URL.

| WMO code | Display description | Semantic icon key |
|---:|---|---|
| 0 | Clear sky | `clear` |
| 1 | Mainly clear | `mainly-clear` |
| 2 | Partly cloudy | `partly-cloudy` |
| 3 | Overcast | `overcast` |
| 45 | Fog | `fog` |
| 48 | Depositing rime fog | `rime-fog` |
| 51 | Light drizzle | `drizzle-light` |
| 53 | Moderate drizzle | `drizzle-moderate` |
| 55 | Dense drizzle | `drizzle-dense` |
| 56 | Light freezing drizzle | `freezing-drizzle-light` |
| 57 | Dense freezing drizzle | `freezing-drizzle-dense` |
| 61 | Slight rain | `rain-slight` |
| 63 | Moderate rain | `rain-moderate` |
| 65 | Heavy rain | `rain-heavy` |
| 66 | Light freezing rain | `freezing-rain-light` |
| 67 | Heavy freezing rain | `freezing-rain-heavy` |
| 71 | Slight snowfall | `snow-slight` |
| 73 | Moderate snowfall | `snow-moderate` |
| 75 | Heavy snowfall | `snow-heavy` |
| 77 | Snow grains | `snow-grains` |
| 80 | Slight rain showers | `rain-showers-slight` |
| 81 | Moderate rain showers | `rain-showers-moderate` |
| 82 | Violent rain showers | `rain-showers-violent` |
| 85 | Slight snow showers | `snow-showers-slight` |
| 86 | Heavy snow showers | `snow-showers-heavy` |
| 95 | Slight or moderate thunderstorm | `thunderstorm` |
| 96 | Thunderstorm with slight hail | `thunderstorm-hail-slight` |
| 99 | Thunderstorm with heavy hail | `thunderstorm-hail-heavy` |
| Any other otherwise-valid integer | Unknown conditions | `unknown` |

## 8. Acceptance Criteria

| ID | Given / When / Then |
|---|---|
| AC-001 | Given an empty city field, when search is submitted, then an enter-city prompt is shown and no Open-Meteo request is made. |
| AC-002 | Given a city search returns multiple candidates, when results are shown, then a selectable list identifies each by city, administrative region, and country, and weather is not requested until one is selected. |
| AC-003 | Given the SPA has just opened, when the user has not selected **Use my location**, then no browser geolocation request is made. |
| AC-004 | Given the user selects **Use my location**, when permission is denied or location fails, then a helpful message is shown and city search remains usable. |
| AC-005 | Given no valid unit preference is stored, when weather is first requested, then Celsius is selected and displayed. |
| AC-006 | Given weather is displayed in Celsius, when the user chooses Fahrenheit, then Fahrenheit is persisted and weather is refetched for the same selected location before Fahrenheit results are presented as current. |
| AC-007 | Given the selected location's local date is 2026-10-27 and sufficient data exists, when forecast is displayed, then only 2026-10-28, 2026-10-29, and 2026-10-30 qualify as the next three days. |
| AC-008 | Given fewer than three qualifying future dates are available, when forecast is displayed, then available dates are shown and missing days are identified without fabricated records. |
| AC-009 | Given an Open-Meteo weather or geocoding request has not completed within 10 seconds, when the timeout is reached, then the request is treated as timed out and a user-visible failure state is provided. |
| AC-010 | Given a transient request failure, when retry policy runs, then at most one automatic retry is made. |
| AC-011 | Given a retryable response contains `Retry-After`, when a retry is considered, then no automatic or manual retry starts before that delay expires. |
| AC-012 | Given a manual retry has just started, when another manual retry is attempted within 1 second, then the second retry is not initiated. |
| AC-013 | Given a location is already saved, when another location with the same Open-Meteo ID and coordinates is added, then the favorites count does not increase. |
| AC-014 | Given multiple favorites and a Fahrenheit preference exist, when one favorite is removed, then only that favorite is removed; when clear-all is subsequently used, then no favorites remain and Fahrenheit remains selected. |
| AC-015 | Given valid favorites and a unit preference are stored, when the SPA is reopened in the same browser profile without site data being cleared, then both are restored from the versioned `localStorage` schema. |
| AC-016 | Given a refresh fails after weather was loaded successfully, when the failure is displayed, then prior weather remains visible, is marked stale, and can be retried subject to the network policy. |
| AC-017 | Given browser geolocation does not complete within 10 seconds, when the timeout occurs, then a helpful error is shown and city search remains available. |
| AC-018 | Given displayed temperatures include 2.5, -2.5, 2.49, and -2.49 degrees, when whole-degree formatting runs, then they display as 3, -3, 2, and -2 respectively. |
| AC-019 | Given forecast records are out of order, identically duplicated, conflicting for one date, or malformed, when the forecast is prepared, then identical records collapse to one, valid records are sorted, every conflicting record for that date and every malformed record is rejected, and no value is merged or fabricated. |
| AC-020 | Given the selected location timezone is unavailable, when forecast preparation runs, then forecast is shown as unavailable without falling back to the device timezone or UTC. |
| AC-021 | Given a schema-v1 document has both valid and invalid entries, when storage is loaded, then invalid entries are reset individually, valid entries remain, and the user is notified; given corrupt JSON or an unsupported future version, then it is not inferred or migrated as v1. |
| AC-022 | Given weather was loaded from explicit device coordinates, when the user saves it, then the favorite uses the `device-coordinates` namespace and does not require an Open-Meteo location ID. |
| AC-023 | Given a stored search favorite and a later candidate have identical provider-precision coordinates but a changed Open-Meteo ID, when the candidate is saved, then the existing identity is migrated and no duplicate is added. |
| AC-024 | Given the SPA is displayed, when attribution is inspected, then the required Open-Meteo credit is available to the user. |
| AC-025 | Given a geocoding or weather response body is 1,048,577 bytes, when it is validated, then the response is rejected before domain publication; a 1,048,576-byte response is not rejected for size alone. |
| AC-026 | Given provider or stored text contains 201 characters, when it is validated, then that field is rejected; a 200-character value is not rejected for length alone. |
| AC-027 | Given 21 geocoding results or a daily array with 17 elements, when the response is validated, then the affected response/component is rejected; counts of 20 and 16 respectively are not rejected for count alone. |
| AC-028 | Given latitude values -90, 90, and 90.0001, longitude values -180, 180, and 180.0001, or humidity values 0, 100, and 100.0001, when validation runs, then boundary values are accepted and out-of-range values are rejected, subject to all other field rules. |
| AC-029 | Given every code listed in Section 7.1, when a condition is displayed, then its exact approved description and semantic key are used from a bundled local SVG; given another otherwise-valid integer code, then **Unknown conditions** and `unknown` are used without an external icon request. |
| AC-030 | Given candidates missing administrative region, country, city/name, or valid coordinates, when candidates are prepared, then missing-region and missing-country candidates remain selectable and show the missing fields as unavailable, while missing-name or invalid-coordinate candidates are rejected. |
| AC-031 | Given a successful retrieval at a known instant and a selected-location timezone, when weather is published, then that instant is formatted in the selected-location timezone and labelled as the successful application retrieval time. |
| AC-032 | Given the valid-v1, mixed-invalid-entry, corrupt-JSON, and unsupported-future-version fixtures, when each is loaded, then v1 is restored or isolated per-entry as applicable and neither corrupt nor future data is treated as a legacy migration. |
| AC-033 | Given `localStorage` is inaccessible, when the SPA starts and favorites are changed, then it remains usable through session memory and continuously warns that changes will not survive the session. |
| AC-034 | Given a confirmed stored document and a later quota/write failure, when a change is attempted, then the last confirmed document remains authoritative and the UI reports that the change was not saved. |
| AC-035 | Given two tabs deliver valid complete documents A and then B through `storage` events, when the receiving tab processes them, then B is the resulting in-memory favorites/preferences document; an invalid later event document does not replace B. |
| AC-036 | Given the shared browser-profile budget has reached 100 requests for the applicable hour or 500 for the applicable day, when any same-origin tab attempts another provider call, then dispatch is blocked and a budget state is shown; no tab bypasses a stricter provider embargo. |
| AC-037 | Given the application is offline, when it opens or a live-weather action is attempted, then no service-worker or weather-cache result is presented and the UI states that a connection is required. |
| AC-038 | Given automated accessibility checks and manual keyboard and screen-reader review in the supported browser matrix, when core search, location, weather, unit, retry, and favorites flows are exercised, then WCAG 2.2 AA criteria apply, all actions are keyboard operable, focus is visible and logical, controls expose names/roles/values, and status/error changes are announced. |
| AC-039 | Given viewport widths of 320, 1440, and a value greater than 1440 CSS pixels in each supported browser, when all core views and error states are exercised, then content and controls remain readable, reachable, and usable without loss of functionality. |
| AC-040 | Given representative mobile measurements at the 75th percentile, when performance is evaluated, then LCP is at most 2.5 seconds, INP at most 200 milliseconds, and CLS at most 0.1; user actions begin visible feedback within 100 milliseconds; initial JavaScript is at most 250 KiB gzip. |
| AC-041 | Given a static-host load test with 100 concurrent users and provider calls stubbed or disabled, when the approved workload runs, then the application and static assets remain serviceable without application failure. |
| AC-042 | Given network and browser diagnostic inspection during all core flows, when privacy behavior is verified, then no telemetry is transmitted, local diagnostics contain none of the prohibited data, the concise geolocation/storage notice is available, and favorites remain until explicitly removed/cleared or browser/site data is cleared. |
| AC-043 | Given a provider response has a missing required field, changed required-field type, excessive array, or out-of-range approved numeric value, when contract validation runs, then it is rejected rather than coerced; unknown extra fields alone do not invalidate an otherwise compatible response. |
| AC-044 | Given supported browsers with different user locales, when English UI weather, dates, and numeric values are displayed, then interface copy remains English and dates/numbers follow each browser locale without changing the selected-location timezone, selected unit, or underlying values. |

## 9. Traceability

### 9.1 Source stories to requirements

| Source | Covered by |
|---|---|
| US-001 | FR-001; AC-001, AC-002 |
| US-002 | FR-002; AC-003, AC-004 |
| US-003 | FR-003; AC-005, AC-006, AC-018, AC-029 |
| US-004 | FR-004; AC-007, AC-008, AC-019, AC-020, AC-027 |
| US-005 | FR-005; AC-009 through AC-012, AC-016, AC-031, AC-036, AC-037 |
| US-006 | FR-006; AC-013 through AC-015, AC-021 through AC-023, AC-032 through AC-035 |
| US-007 | FR-007; NFR-001 through NFR-016; AC-024 through AC-030 and AC-038 through AC-044 |

US-002 originally described automatic location detection on application open.
The user-approved correction intentionally supersedes that trigger with the
explicit **Use my location** action in FR-002.

### 9.2 Design-review findings to revised requirements

| Finding | Disposition in this revision |
|---|---|
| DR-001 | Resolved in the approved architecture by consistent gate metadata and recorded approval. |
| DR-002 | Addressed by the verified `/v1/search` and `/v1/forecast` contracts, direct browser CORS evidence, non-commercial boundary, quotas, attribution, and no-confidential-key boundary. |
| DR-003 | Addressed by FR-001 candidate selection and FR-006 namespaced search/device identities, rejection of ID-less search candidates, and coordinate-matched ID migration. |
| DR-004 | Addressed by FR-003 Celsius default, local persistence, user switching, refetch-on-change, whole-degree rounding, and the approved away-from-zero tie rule. |
| DR-005 | Addressed by FR-004's exclusion of today, selected-location timezone, daily high/low semantics, validation, sorting, identical-record deduplication, conflicting-date rejection, and no-inferred-timezone behavior. |
| DR-006 | Addressed by FR-005 and the approved architecture policy: 10-second per-attempt timeout, one retry for the approved transient classes, bounded jitter, `Retry-After` embargo, and 1-second manual cooldown. |
| DR-007 | Addressed by FR-006's schema-v1 `localStorage`, minimum fields, remove-one, clear-all preserving units, provider-returned coordinate precision, fixture set, per-entry recovery, fallback, write-failure, and cross-tab requirements. |
| DR-008 | Addressed by FR-002's explicit user action and prohibition on automatic invocation. |
| DR-009 | Resolved by the approved architecture's bounded component aggregation, atomic publication, and stale-token rejection rules; this revision does not change those rules. |
| DR-010 | Addressed by NFR-003, NFR-008, and NFR-010 through NFR-013, with measurable accessibility, compatibility, responsive, performance, asset-size, and load targets and an explicit absence of an end-to-end SLA. |
| DR-011 | Adopted; provider-neutral typed result and error contracts are required before adapter implementation. |
| DR-012 | Deferred because the approved direct-client integration has no BFF. |
| DR-013 | Adopted; speculative infrastructure shall not be added without an approved driver. |

### 9.3 Implementation-plan blocker decisions to requirements

| Blocker | Approved requirements-level disposition dated 2026-10-27 |
|---|---|
| B-003 | NFR-004/NFR-016 and AC-025 through AC-028/AC-043 set provider caps, complete numeric bounds, and incompatible-contract rejection. |
| B-004 | FR-003.13–FR-003.14, Section 7.1, and AC-029 define complete documented WMO semantics, unknown-code behavior, and bundled local SVGs. |
| B-005 | FR-001.8/FR-001.11, BR-016, and AC-030 define candidate validity and missing-field behavior. |
| B-006 | FR-003.12, FR-004.8, BR-014/BR-015, and AC-018/AC-019 define duplicate and rounding behavior. |
| B-007 | FR-006.14/FR-006.20, BR-018, and AC-021/AC-032 define schema v1 and mandatory fixture families; no legacy versions exist initially. |
| B-008 | FR-006.12, BR-010, and AC-014 require clear-all to preserve unit preference. |
| B-009 | FR-006.17–FR-006.19, BR-019/BR-020, and AC-033 through AC-035 define fallback, write failure, and latest-document-wins behavior. |
| B-010 | FR-005.6, BR-017, and AC-031 define successful application retrieval time in the selected-location timezone. |
| B-011 | FR-007.8–FR-007.10, NFR-003/NFR-008, and AC-038/AC-039 define accessibility, browser, viewport, English-language, and locale-formatting targets. |
| B-012 | FR-007.11, NFR-014/NFR-015, and AC-042 define no telemetry, local diagnostics, notice, and retention. |
| B-013 | Approved as an architecture/release decision: strict CSP and headers, lockfile, CI audit/dependency review, and monthly updates. |
| B-014 | FR-005.12–FR-005.13, BR-021, and AC-036/AC-037 define online-only/no-cache operation and shared rolling 60-minute/24-hour request budgets. |
| B-015 | Approved as an architecture/deployment decision: Cloudflare Pages with a Vite static build. |
| B-016 | NFR-010 through NFR-013 and AC-040/AC-041 define the Lighthouse CI profile, initial-JavaScript target, k6 static-load thresholds, and no-SLA requirement. |

## 10. Approved Correction Inputs, Assumptions, and Remaining Information

### 10.1 User-approved correction inputs

The following facts were supplied by the user for this revision:

- browser SPA;
- direct Open-Meteo weather and geocoding integration with no confidential API
  key;
- Celsius default;
- locally persisted Celsius/Fahrenheit selection, with refetch on change;
- three forecast days exclude today and use the selected location timezone;
- geolocation only after explicit **Use my location** action;
- versioned browser `localStorage` for favorites/preferences, minimal location
  fields, remove-one, and clear-all;
- selectable ambiguous-city results with city, administrative region, and
  country;
- favorite identity composed of Open-Meteo location ID plus coordinates; and
- a 10-second network timeout, one automatic retry for transient failures,
  honoring `Retry-After`, and a 1-second manual retry cooldown;
- a 10-second browser-geolocation timeout;
- daily high and low forecast temperatures rounded to whole degrees;
- rejection of malformed forecast records, display of remaining valid days,
  and no inferred timezone fallback;
- provider-returned coordinate precision with versioned-schema handling and
  per-entry invalid-data reset plus user notification; and
- adoption of DR-011 and DR-013, with DR-010 and DR-012 deferred until
  relevant;
- namespaced coordinate identity for device locations and coordinate-matched
  migration when a search provider ID changes; and
- non-commercial use of Open-Meteo's free API with required attribution and
  documented quotas;
- a 1 MiB provider-response cap, 200-character strings, at most 20 geocoding
  results, at most 16 daily-array elements, strict numeric validation, and
  rejection of incompatible contract changes;
- documented WMO mapping, **Unknown conditions** fallback, and bundled local
  SVG icons;
- candidate validity, duplicate-date conflict handling, identical-record
  deduplication, and exact half-degree rounding away from zero;
- schema v1 with no initial legacy versions, required storage fixtures,
  clear-all preserving units, session-memory fallback, honest write failure,
  and latest-document-wins cross-tab synchronization;
- successful application retrieval time displayed in the location timezone;
- WCAG 2.2 AA, keyboard/screen-reader behavior, the latest two browser major
  versions, 320-through-1440+ responsive support, and English UI with
  locale-aware date/number formatting;
- no telemetry, local-only diagnostics, a concise geolocation/storage notice,
  and favorite retention until user/browser deletion;
- online-only behavior without a service worker or weather cache and a
  browser-profile budget of 500 requests/day and 100/hour coordinated through
  `localStorage`/`BroadcastChannel`; and
- LCP, INP, CLS, UI-feedback, initial-JavaScript, 100-concurrent-static-user,
  and no-end-to-end-SLA quality decisions stated in NFR-010 through NFR-013.

### 10.2 Assumptions

No additional assumptions are approved.

### 10.3 Remaining **Not Found** information

1. Concrete source paths and module file names, which are implementation-plan
   details.
2. The exact Node.js major that satisfies the approved current Active LTS
   policy when scaffolding occurs.

## 11. Approval Status

This revised requirements baseline was **approved by the user on 2026-10-27**.

Stage 4 implementation-plan revision and review may proceed against this
approved baseline. This approval does not authorize production implementation.
