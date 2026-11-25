// EscrowLens HTTP server — zero dependencies (Node >= 18).
// Serves the dashboard + a tiny JSON API. Reads live chain data via
// src/indexer.js and caches it for CACHE_TTL_MS.
//
//   GET /                       dashboard
//   GET /api/trust/:agent       score card for one agent
//   GET /api/trust/:agent?demo=1   clearly-labelled fixture archetypes
//   GET /api/leaderboard        top agents by score
//   GET /api/health             sync status
//
// No wallet, no signing, no user data stored. The only "private" part of
// this project lives in the T3 TEE contract (src/t3/ + tee-contract/).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CACHE_TTL_MS, CHAIN, PORT } from "./config.js";
import { scoreAgent, scoreAll } from "./scorer.js";
import { DEMO_AGENTS, demoFor } from "./demo.js";
import { syncAll } from "./indexer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

let cache = { data: null, at: 0, error: null };

async function getData(force = false) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  try {
    cache.data = await syncAll();
    cache.at = now;
    cache.error = null;
  } catch (err) {
    cache.error = err.message;
    if (!cache.data) throw err; // nothing cached yet: propagate
  }
  return cache.data;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function trustCard(agent, history, source, updatedAt) {
  const result = scoreAgent(history);
  return {
    agent: agent.toLowerCase(),
    source,
    updatedAt,
    score: result.score,
    grade: result.grade,
    insufficient: result.insufficient,
    reason: result.reason,
    breakdown: result.breakdown,
    counts: result.counts,
    signals: result.signals,
    explorer: `${CHAIN.explorer}/address/${agent}`,
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      const html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    if (path === "/api/health") {
      const data = cache.data;
      json(res, 200, {
        ok: true,
        chain: CHAIN.name,
        chainId: CHAIN.id,
        lastSync: data ? data.meta.syncedAt : null,
        escrows: data ? data.meta.escrows : null,
        events: data ? data.meta.events : null,
        agents: data ? Object.keys(data.agents).length : null,
        syncError: cache.error,
      });
      return;
    }

    if (path === "/api/leaderboard") {
      const data = await getData(url.searchParams.get("refresh") === "1");
      const scored = scoreAll(data.agents);
      const rows = Object.entries(scored)
        .filter(([, r]) => r.score !== null)
        .map(([agent, r]) => ({ agent, score: r.score, grade: r.grade, counts: r.counts }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      json(res, 200, { source: "chain", updatedAt: data.meta.syncedAt, rows });
      return;
    }

    const trustMatch = path.match(/^\/api\/trust\/(0x[0-9a-fA-F]{40})$/);
    if (trustMatch) {
      const agent = trustMatch[1];
      if (url.searchParams.get("demo") === "1") {
        const demo = demoFor(agent);
        if (!demo) {
          json(res, 404, {
            error: "no demo fixture for this address",
            fixtures: Object.values(DEMO_AGENTS).map((d) => ({
              label: d.label,
              address: d.address,
            })),
          });
          return;
        }
        json(res, 200, {
          ...trustCard(agent, demo.history, "demo", new Date().toISOString()),
          demoLabel: demo.label,
        });
        return;
      }
      const data = await getData(url.searchParams.get("refresh") === "1");
      const history = data.agents[agent.toLowerCase()] ?? {
        created: 0,
        delivered: 0,
        released: 0,
        refunded: 0,
        rejections: 0,
        expired: 0,
        deliveryRatios: [],
      };
      json(res, 200, trustCard(agent, history, "chain", data.meta.syncedAt));
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`EscrowLens listening on http://localhost:${PORT}`);
  // Warm the cache in the background so the first dashboard load already
  // serves live-synced data (a cold sync scans ~690k blocks per contract).
  getData(true).then(
    (d) =>
      console.log(
        `initial sync done: ${d.meta.escrows} escrows, ${d.meta.events} events, block ${d.meta.latestBlock} (${d.meta.transport})`,
      ),
    (err) => console.error("initial sync failed:", err.message),
  );
});
