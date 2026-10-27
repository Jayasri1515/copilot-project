import { check } from 'k6';
import http from 'k6/http';

const rawBaseUrl = __ENV.BASE_URL;
if (!rawBaseUrl) {
  throw new Error('BASE_URL must identify the local production preview.');
}

const baseMatch =
  /^http:\/\/(127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/i.exec(rawBaseUrl);
if (!baseMatch) {
  throw new Error(
    'BASE_URL must be an HTTP loopback IP URL without credentials, path, query, or fragment.',
  );
}
const port = baseMatch[2] ? Number(baseMatch[2]) : undefined;
if (port !== undefined && (port < 1 || port > 65535)) {
  throw new Error('BASE_URL port must be between 1 and 65535.');
}
const rootUrl = `http://${baseMatch[1]}${port ? `:${port}` : ''}/`;

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  // Deliberately request only the static page and its same-origin built assets.
  // No application code is executed, so no Open-Meteo request can be emitted.
  const response = http.get(rootUrl, { redirects: 0 });
  const pageOk = check(response, {
    'static page returns 200': (res) => res.status === 200,
    'static page is HTML': (res) =>
      (res.headers['Content-Type'] ?? '').includes('text/html'),
  });

  const matches = [...(response.body ?? '').matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)];
  const assetPaths = [...new Set(matches.map((match) => match[1]))];
  const assetsAreLocal =
    assetPaths.length > 0 &&
    assetPaths.every((path) =>
      /^\/?assets\/[A-Za-z0-9._/-]+\.(?:js|css)$/.test(path) &&
      !path.split('/').includes('..'),
    );
  check(assetsAreLocal, {
    'page references same-origin built assets only': (local) => local,
  });

  if (pageOk && assetsAreLocal) {
    for (const assetPath of assetPaths) {
      const assetUrl = `${rootUrl}${assetPath.replace(/^\/+/, '')}`;
      const assetResponse = http.get(assetUrl, { redirects: 0 });
      check(assetResponse, {
        'built asset returns 200': (res) => res.status === 200,
      });
    }
  }
}
