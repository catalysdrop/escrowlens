// EscrowLens indexer — reads AgentEscrow history from Aevum testnet.
//
// Data flow:
//   1. eth_blockNumber (latest block)
//   2. eth_getLogs per contract, paged in LOG_CHUNK_BLOCKS (1000) — the Aevum
//      RPC rejects larger ranges with -32000 "block range too large".
//      Chunks are fetched with bounded concurrency (5) and the logs are
//      re-sorted by (blockNumber, logIndex) before decoding, so event order
//      is preserved (EscrowCreated before later events for the same escrow).
//   3. eth_getBlockByNumber for the timestamp of each event block (cached).
//   4. eth_call escrowOf(taskId) per created escrow for its CURRENT status
//      (events tell you what happened; escrowOf tells you where it stands now,
//      incl. "deadline passed, still Created, never delivered" = expired).
//
// Transport: src/rpc.js tries Node fetch first and falls back to raw curl
// (execFile, argument array) when fetch cannot reach the RPC — in some
// sandboxed shells fetch ignores the egress proxy while curl works.
// Usage:
//   node src/indexer.js --print            # sync + print JSON to stdout
//   node src/indexer.js --out data/index.json
//
// No wallet, no signing, no private keys — read-only.

import { writeFileSync } from "node:fs";
import { CHAIN, ESCROW_CONTRACTS, LOG_CHUNK_BLOCKS } from "./config.js";
import { TOPIC_LIST, decodeLog, encodeEscrowOf, decodeEscrowOf } from "./abi.js";
import { rpc, transportUsed } from "./rpc.js";

const hexToInt = (h) => Number(BigInt(h));

// Bounded concurrency for chunk fetches. The full range from deploy block
// to latest is ~690k blocks per contract (~690 chunks of 1000); sequential
// fetching would take many minutes. Logs are re-sorted after fetching, so
// concurrency does not change event order.

export async function getLatestBlock() {
  return hexToInt(await rpc("eth_blockNumber", []));
}

async function getLogs(address, fromBlock, toBlock) {
  return rpc("eth_getLogs", [
    {
      address,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
      topics: [TOPIC_LIST],
    },
  ]);
}

const LOG_FETCH_CONCURRENCY = 5;

export async function syncContract(contract, latestBlock, blockTimestamps) {
  const ranges = [];
  let from = contract.deployBlock;
  while (from <= latestBlock) {
    const to = Math.min(from + LOG_CHUNK_BLOCKS - 1, latestBlock);
    ranges.push([from, to]);
    from = to + 1;
  }
  const allLogs = [];
  for (let i = 0; i < ranges.length; i += LOG_FETCH_CONCURRENCY) {
    const batch = ranges.slice(i, i + LOG_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(([f, t]) => getLogs(contract.address, f, t)),
    );
    for (const logs of results) allLogs.push(...logs);
  }
  // Restore chain order (concurrent chunk fetches finish out of order).
  allLogs.sort((a, b) => {
    const ba = hexToInt(a.blockNumber);
    const bb = hexToInt(b.blockNumber);
    if (ba !== bb) return ba - bb;
    return hexToInt(a.logIndex) - hexToInt(b.logIndex);
  });
  const events = [];
  for (const log of allLogs) {
    const decoded = decodeLog(log);
    if (decoded) events.push({ ...decoded, contract: contract.version });
  }
  return events;
}

async function getBlockTimestamp(blockNumber, cache) {
  if (cache.has(blockNumber)) return cache.get(blockNumber);
  const block = await rpc("eth_getBlockByNumber", [
    "0x" + blockNumber.toString(16),
    false,
  ]);
  const ts = hexToInt(block.timestamp);
  cache.set(blockNumber, ts);
  return ts;
}

async function getEscrowState(contractAddress, taskId) {
  const raw = await rpc("eth_call", [
    { to: contractAddress, data: encodeEscrowOf(taskId) },
    "latest",
  ]);
  return decodeEscrowOf(raw);
}

/**
 * Full sync: returns { agents, meta } where agents maps a lowercase agent
 * address to a scorer.js history object.
 */
export async function syncAll() {
  const latestBlock = await getLatestBlock();
  const blockTimestamps = new Map();
  const escrows = new Map(); // taskId -> { created, contract, ... }
  let eventsTotal = 0;

  for (const contract of ESCROW_CONTRACTS) {
    const events = await syncContract(contract, latestBlock, blockTimestamps);
    eventsTotal += events.length;
    for (const ev of events) {
      if (ev.event === "EscrowCreated") {
        escrows.set(ev.taskId, {
          taskId: ev.taskId,
          contract,
          client: ev.client,
          agent: ev.agent,
          amount: ev.amount,
          deadline: ev.deadline,
          createdBlock: ev.blockNumber,
          createdAt: await getBlockTimestamp(ev.blockNumber, blockTimestamps),
          deliveredAt: null,
          deliveryRatio: null,
          rejections: 0,
          state: null,
        });
      } else {
        const esc = escrows.get(ev.taskId);
        if (!esc) continue; // event for an escrow created before our window
        if (ev.event === "Delivered") {
          esc.deliveredAt = await getBlockTimestamp(ev.blockNumber, blockTimestamps);
          const allowed = Math.max(1, esc.deadline - esc.createdAt);
          esc.deliveryRatio = Math.max(
            0,
            Math.min(1, (esc.deliveredAt - esc.createdAt) / allowed),
          );
        } else if (ev.event === "DeliveryRejected") {
          esc.rejections += 1;
        }
      }
    }
  }

  // Current on-chain state per escrow (status + deliveredAt from the contract).
  const now = await getBlockTimestamp(latestBlock, blockTimestamps);
  for (const esc of escrows.values()) {
    esc.state = await getEscrowState(esc.contract.address, esc.taskId);
  }

  // Aggregate per agent.
  const agents = {};
  for (const esc of escrows.values()) {
    const a = (agents[esc.agent] ??= {
      created: 0,
      delivered: 0,
      released: 0,
      refunded: 0,
      rejections: 0,
      expired: 0,
      deliveryRatios: [],
    });
    a.created += 1;
    a.rejections += esc.rejections;
    if (esc.state.statusName === "Released") a.released += 1;
    if (esc.state.statusName === "Refunded") a.refunded += 1;
    if (esc.state.statusName === "Delivered" || esc.deliveredAt !== null) {
      a.delivered += 1;
      if (esc.deliveryRatio !== null) a.deliveryRatios.push(esc.deliveryRatio);
    }
    // Expired: deadline passed, still Created, never delivered.
    if (
      esc.state.statusName === "Created" &&
      esc.state.deliveredAt === 0 &&
      esc.deadline < now
    ) {
      a.expired += 1;
    }
  }

  return {
    agents,
    meta: {
      chain: CHAIN.name,
      chainId: CHAIN.id,
      latestBlock,
      syncedAt: new Date().toISOString(),
      transport: transportUsed(),
      escrows: escrows.size,
      events: eventsTotal,
      contracts: ESCROW_CONTRACTS.map((c) => `${c.version}:${c.address}`),
    },
  };
}

// CLI
const isMain = process.argv[1]?.endsWith("indexer.js");
if (isMain) {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  syncAll()
    .then((data) => {
      if (outPath) {
        writeFileSync(outPath, JSON.stringify(data, null, 2));
        console.log(`wrote ${outPath}: ${data.meta.escrows} escrows, ${data.meta.events} events`);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    })
    .catch((err) => {
      console.error("sync failed:", err.message);
      process.exit(1);
    });
}
