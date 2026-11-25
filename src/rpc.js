// JSON-RPC transport for the Aevum testnet RPC.
//
// Tries Node fetch first; on failure falls back to raw curl (spawned via
// execFile with an argument array — never shell-interpolated, so addresses
// and block numbers cannot break out of the command).
//
// Why the fallback exists: in some sandboxed shells Node's global fetch
// ignores the egress proxy and cannot reach the RPC at all, while curl
// (which honours the proxy env) works fine. Verified 24 Nov 2026:
// curl https://rpc-test.qday.info returns the latest block. In this exec
// session fetch ALSO works, but the fallback keeps the indexer working in
// either environment. Once fetch fails once, it is skipped for the rest of
// the process (fetchBroken latch) so every later call goes straight to curl.

import { execFile } from "node:child_process";
import { CHAIN } from "./config.js";

const FETCH_TIMEOUT_MS = 15_000;
const CURL_TIMEOUT_MS = 30_000;

let fetchBroken = false; // once fetch fails, go straight to curl
let lastTransport = "fetch";

/** Which transport served the most recent successful call. */
export function transportUsed() {
  return lastTransport;
}

function curlRpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    });
    // Argument array — no shell, no interpolation of method/params.
    const args = [
      "-sS",
      "--max-time",
      String(CURL_TIMEOUT_MS / 1000),
      "-X",
      "POST",
      CHAIN.rpcUrl,
      "-H",
      "Content-Type: application/json",
      "--data",
      body,
    ];
    execFile(
      "curl",
      args,
      { timeout: CURL_TIMEOUT_MS + 5_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `curl ${method}: ${err.message}${
                stderr ? ` — ${String(stderr).trim().slice(0, 200)}` : ""
              }`,
            ),
          );
          return;
        }
        let json;
        try {
          json = JSON.parse(stdout);
        } catch {
          reject(
            new Error(`curl ${method}: non-JSON reply: ${String(stdout).slice(0, 200)}`),
          );
          return;
        }
        if (json.error) {
          reject(
            new Error(`RPC ${method}: ${json.error.message} (${json.error.code ?? "?"})`),
          );
          return;
        }
        resolve(json.result);
      },
    );
  });
}

async function fetchRpc(method, params) {
  const res = await fetch(CHAIN.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC ${method}: ${json.error.message} (${json.error.code ?? "?"})`);
  }
  return json.result;
}

/**
 * One JSON-RPC call: fetch first, curl on failure.
 * Retries the whole call once (1s backoff) on transient errors.
 */
export async function rpc(method, params) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!fetchBroken) {
        try {
          const result = await fetchRpc(method, params);
          lastTransport = "fetch";
          return result;
        } catch (e) {
          fetchBroken = true;
          lastErr = e;
        }
      }
      const result = await curlRpc(method, params);
      lastTransport = "curl";
      return result;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
  }
  throw lastErr;
}
