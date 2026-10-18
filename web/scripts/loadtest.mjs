#!/usr/bin/env node
// Stress test for a running Quiz.me stack (docker compose or a test
// deployment you own). Never point it at someone else's server.
//
//   node scripts/loadtest.mjs [base-url]      default http://localhost:3000
//
// Phases:
//   1. flood    many concurrent page requests from one client; expects the
//               rate limiter to answer 429 with Retry-After and no 5xx
//   2. health   the health endpoint stays fast while the flood runs
//   3. uploads  burst of upload POSTs; expects 401/429, never 5xx
//   4. slowloris hundreds of connections that send headers very slowly;
//               normal requests must still be served
//   5. recovery after waiting out Retry-After, the client is served again
//
// Exits non-zero if any expectation fails.

import net from "node:net";

const BASE = new URL(process.argv[2] ?? process.env.LOADTEST_BASE_URL ?? "http://localhost:3000");
const FLOOD_SECONDS = Number(process.env.LOADTEST_FLOOD_SECONDS ?? 10);
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY ?? 64);
const SLOW_SOCKETS = Number(process.env.LOADTEST_SLOW_SOCKETS ?? 300);

const failures = [];
const expect = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(path, init = {}) {
  const started = performance.now();
  try {
    const res = await fetch(new URL(path, BASE), { redirect: "manual", ...init });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get("retry-after") };
  } catch (err) {
    return { status: 0, ms: performance.now() - started, error: String(err?.cause?.code ?? err) };
  }
}

async function flood(path, seconds, concurrency) {
  const deadline = Date.now() + seconds * 1000;
  const results = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < deadline) results.push(await timed(path));
    }),
  );
  return results;
}

function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

async function main() {
  console.log(`Load test against ${BASE.origin}`);
  const warm = await timed("/api/health");
  if (warm.status !== 200) {
    console.error(`Health check failed (${warm.status}); is the stack running?`);
    process.exit(2);
  }

  console.log(`\n1. Flood /signin with ${CONCURRENCY} concurrent clients for ${FLOOD_SECONDS}s, probing /api/health`);
  const healthProbes = [];
  let flooding = true;
  const prober = (async () => {
    while (flooding) {
      healthProbes.push(await timed("/api/health"));
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const results = await flood("/signin", FLOOD_SECONDS, CONCURRENCY);
  flooding = false;
  await prober;
  const counts = summarize(results);
  const rps = Math.round(results.length / FLOOD_SECONDS);
  console.log(`   ${results.length} requests (${rps}/s), status counts ${JSON.stringify(counts)}`);
  console.log(
    `   latency p50 ${percentile(results.map((r) => r.ms), 50).toFixed(0)} ms, p95 ${percentile(results.map((r) => r.ms), 95).toFixed(0)} ms`,
  );
  expect((counts[429] ?? 0) > 0, "flood is rate limited (429s returned)");
  expect(
    results.filter((r) => r.status === 429).every((r) => Number(r.retryAfter) >= 1),
    "every 429 carries Retry-After",
  );
  expect(!results.some((r) => r.status >= 500 || r.status === 0), "no 5xx or dropped connections during the flood");

  console.log("\n2. Health endpoint during the flood");
  const hp95 = percentile(healthProbes.map((r) => r.ms), 95);
  console.log(`   ${healthProbes.length} probes, p95 ${hp95.toFixed(0)} ms`);
  expect(healthProbes.every((r) => r.status === 200), "health always 200 (probes are never throttled)");
  expect(hp95 < 1000, "health p95 under 1 s");

  console.log("\n3. Upload burst (unauthenticated) from one client");
  const uploads = await Promise.all(
    Array.from({ length: 60 }, () =>
      timed("/api/uploads", {
        method: "POST",
        headers: { origin: BASE.origin, "content-type": "application/octet-stream" },
        body: new Uint8Array(1024),
      }),
    ),
  );
  const uploadCounts = summarize(uploads);
  console.log(`   status counts ${JSON.stringify(uploadCounts)}`);
  expect((uploadCounts[429] ?? 0) > 0, "upload burst is rate limited per IP before authentication");
  expect(uploads.every((r) => [401, 429].includes(r.status)), "only 401/429 on the upload burst (no server errors)");

  console.log(`\n4. Slowloris: ${SLOW_SOCKETS} connections sending headers one byte at a time`);
  const sockets = [];
  for (let i = 0; i < SLOW_SOCKETS; i++) {
    const s = net.connect(Number(BASE.port || 80), BASE.hostname);
    s.on("error", () => {});
    s.write(`GET /signin HTTP/1.1\r\nHost: ${BASE.host}\r\n`);
    sockets.push(s);
  }
  const drip = setInterval(() => {
    for (const s of sockets) if (!s.destroyed) s.write("X-a: b\r\n");
  }, 1000);
  await new Promise((r) => setTimeout(r, 3000));
  const during = await Promise.all(Array.from({ length: 5 }, () => timed("/api/health")));
  clearInterval(drip);
  for (const s of sockets) s.destroy();
  console.log(`   health during slowloris: ${during.map((r) => `${r.status}/${r.ms.toFixed(0)}ms`).join(", ")}`);
  expect(during.every((r) => r.status === 200 && r.ms < 2000), "server keeps answering during slowloris");

  console.log("\n5. Recovery after honouring Retry-After");
  let probe = await timed("/signin");
  let waited = 0;
  while (probe.status === 429 && waited < 120) {
    const wait = Math.max(1, Number(probe.retryAfter) || 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    waited += wait;
    probe = await timed("/signin");
  }
  console.log(`   waited ${waited}s, then status ${probe.status}`);
  expect(probe.status === 200, "client is served again after waiting");

  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll load test checks passed");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
