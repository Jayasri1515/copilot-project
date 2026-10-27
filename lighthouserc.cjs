module.exports = {
  ci: {
    collect: {
      numberOfRuns: 20,
      startServerCommand: 'npm run preview -- --host 127.0.0.1 --port 4173',
      startServerReadyPattern: 'Local',
      url: ['http://127.0.0.1:4173/'],
      settings: {
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        disableStorageReset: false,
        throttling: {
          cpuSlowdownMultiplier: 4,
          downloadThroughputKbps: 1600,
          uploadThroughputKbps: 750,
          requestLatencyMs: 150,
        },
      },
    },
    // LHCI requires a non-empty assertion map. Keep its per-run assertions
    // disabled because T-110 gates LCP/CLS using the approved nearest-rank
    // p75 across all 20 collected reports in aggregate-lighthouse.mjs.
    assert: { assertions: { 'categories:performance': 'off' } },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
