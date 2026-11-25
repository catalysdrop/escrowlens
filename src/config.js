// EscrowLens configuration.
// Every value below was verified live on 24 Nov 2026 against the Aevum
// testnet RPC (https://rpc-test.qday.info) and explorer API
// (https://explorer-test.qday.info/api). Do not "fix" these from memory.

export const CHAIN = {
  id: 44005,
  name: "QDay Aevum testnet",
  rpcUrl: "https://rpc-test.qday.info",
  explorer: "https://explorer-test.qday.info",
  token: {
    address: "0x456569838f1d43009A91ebA4263147Afd7233483",
    symbol: "tUSD8",
    decimals: 6,
  },
};

// AgentEscrow deployments. v2 is the live one (audited, AUDIT.md in the
// agent-escrow repo); v1 holds the original demo escrow. Both are indexed.
export const ESCROW_CONTRACTS = [
  {
    version: "v2",
    address: "0x54e833291455D68e944D178FBbbF3F7Ebb359046",
    deployBlock: 3308598,
    deployTx:
      "0x4d3d03351b8d3c1997da558c6fa89571cd9f3485b2890f381832082e7afd6b9c",
  },
  {
    version: "v1",
    address: "0x655a895477fBb38fB4A7c279cad04A4e218F284b",
    deployBlock: 3302809,
  },
];

// Grace period after delivery, from AgentEscrow.GRACE_PERIOD (1 day).
export const GRACE_PERIOD_SECONDS = 86_400;

// VERIFIED RPC LIMIT: Aevum eth_getLogs rejects any range over 1000 blocks
// with -32000 "block range too large, max range: 1000". The indexer pages
// in chunks of at most this size. An un-paged query silently errors and
// looks like "0 events" — do not raise this number.
export const LOG_CHUNK_BLOCKS = 1000;

// How long the server caches indexed data before re-syncing.
export const CACHE_TTL_MS = 10 * 60 * 1000;

export const PORT = Number(process.env.PORT ?? 3000);
