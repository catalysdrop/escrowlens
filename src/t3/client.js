// Terminal 3 ADK client — Phase 2 of EscrowLens.
//
// What this does, in the official ADK shape (docs.terminal3.io):
//   1. Authenticate with SIWE (Ethereum wallet) → encrypted channel to a TEE node.
//   2. Open the tenant client (tenantDid) and a private tenant map that holds
//      the customer's hiring policy (min score, blocked agents, ...).
//   3. Register the EscrowLens TEE contract (tee-contract/) and invoke its
//      `check` function: the contract reads the sealed policy, scores the
//      agent history supplied in the input, and answers yes/no + a score band.
//      The agent NEVER sees the policy itself.
//
// Status: VERIFIED LIVE 24 Nov ~23:00 WITA (run-register.mjs in
// ../my-t3n-app). Contract z:11d4bb95e448f0096778ed4f92d00d1cd969d722:escrow-trust
// (id 1150, v0.1.0) registered; policy map trust-policies created; store +
// check executed in the TEE: ghost agent scored 6.9 / grade D, acceptable
// false — identical to the local scorer.
//
// API notes (verified against @terminal3/t3n-sdk dist/index.d.ts — the
// original scaffold guessed several of these wrong):
//   - TenantClient takes a CONFIG object: { t3n, tenantDid, environment,
//     baseUrl } — NOT (client, did).
//   - contracts.register({ tail, version, wasm }) -> { name, contract_id }.
//   - contracts.execute(tail, { version, functionName, input }) — input is
//     the plain OBJECT (the host JSON-encodes it); passing a JSON string
//     double-encodes it and the contract rejects it ("expected struct
//     Policy").
//   - maps.create({ tail, visibility, writers, readers }); ReaderSet /
//     WriterSet are "all" | { only: number[] } (contract ids). Omitting
//     readers defaults to deny-all.
//   - The contract reads the policy from map z:<tid>:trust-policies under
//     the CALLER's DID hex as key, so the policy must be stored through the
//     contract's `store` export — NOT via maps entrySet with key "policy".
//   - History fields are snake_case (delivery_ratios) to match the Rust
//     struct (deny_unknown_fields); the indexer emits camelCase, so
//     checkAgent converts before calling.
//   - In this sandbox, Node's fetch fails on POST /api/rpc through the
//     egress proxy: set globalThis.fetch to the curl-backed transport
//     (../my-t3n-app/fetch-curl.mjs, which also serialises FormData for the
//     wasm upload) BEFORE calling connectTenant.
//
// Needs, before first use:
//   - `npm install @terminal3/t3n-sdk` (optional dependency in package.json)
//   - a claimed T3 key + test credits + an organisation:
//     https://www.terminal3.io/claim-page (self-serve, free)
//   - T3N_PRIVATE_KEY in the environment — the private key of the ETH wallet
//     registered with T3. NEVER put it in a file, never commit it.
//
// The SDK is imported dynamically so the zero-dependency core (indexer,
// scorer, server) keeps working without it installed.

const POLICY_MAP_NAME = "trust-policies";
const CONTRACT_TAIL = "escrow-trust";
const CONTRACT_VERSION = "0.1.0";

async function loadSdk() {
  try {
    return await import("@terminal3/t3n-sdk");
  } catch {
    throw new Error(
      "T3 SDK not installed — run: npm install @terminal3/t3n-sdk " +
        "(after claiming a key at https://www.terminal3.io/claim-page)",
    );
  }
}

function requireKey() {
  const key = process.env.T3N_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "T3N_PRIVATE_KEY is not set — export it in your shell (never in a file). " +
        "It is the private key of the ETH wallet you registered with Terminal 3.",
    );
  }
  return key;
}

/**
 * Authenticate to T3N (testnet) and return { sdk, client, tenant, did }.
 * Follows the ADK quickstart: setEnvironment → loadWasmComponent →
 * resolveTrustAnchor → T3nClient → handshake → authenticate (SIWE).
 * Pass opts.fetchImpl to override the fetch implementation (in this sandbox
 * use the curl-backed fetch from ../my-t3n-app/fetch-curl.mjs).
 */
export async function connectTenant(opts = {}) {
  const sdk = await loadSdk();
  const privateKey = requireKey();
  sdk.setEnvironment("testnet");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (fetchImpl && fetchImpl !== globalThis.fetch) globalThis.fetch = fetchImpl;
  const wasmComponent = await sdk.loadWasmComponent();
  const address = sdk.eth_get_address(privateKey);
  const client = new sdk.T3nClient({
    wasmComponent,
    trustAnchor: await sdk.resolveTrustAnchor("testnet"),
    handlers: {
      EthSign: sdk.metamask_sign(address, undefined, privateKey),
    },
  });
  await client.handshake();
  const did = await client.authenticate(
    sdk.createEthAuthInput(sdk.eth_get_address(privateKey)),
  );
  const didValue = did?.value ?? did;
  const tenant = new sdk.TenantClient({
    t3n: client,
    tenantDid: didValue,
    environment: "testnet",
    baseUrl: sdk.NODE_URLS.testnet,
    fetch: fetchImpl,
  });
  return { sdk, client, tenant, did: didValue };
}

/**
 * Create the private policy map if missing (tenant-scoped).
 * The map is readable/writable ONLY by the registered escrow-trust
 * contract (by numeric contract id) — that is how the sealed policy stays
 * sealed: the contract reads it in-enclave, nobody else can.
 */
export async function ensurePolicyMap(tenant, contractId) {
  const maps = await tenant.maps.list();
  const existing = (maps || []).find(
    (m) => (m?.name || m?.tail || m) === POLICY_MAP_NAME ||
      String(m?.name || m || "").endsWith(`:${POLICY_MAP_NAME}`),
  );
  if (existing) return existing;
  return tenant.maps.create({
    tail: POLICY_MAP_NAME,
    visibility: "private",
    writers: { only: [contractId] },
    readers: { only: [contractId] },
  });
}

/**
 * Store the customer's hiring policy, sealed in their tenant map.
 * Policy shape (see tee-contract/examples/policy.json):
 *   { min_score, max_dispute_rate_bps, blocked_agents: [], require_delivery: true }
 * Stored through the contract's `store` export, which writes it under the
 * caller's DID as key and refuses delegated writes — the customer themself
 * is the only writer. Only the customer writes their own row — enforced
 * again inside the contract.
 */
export async function storePolicy(tenant, policy) {
  const res = await tenant.contracts.execute(CONTRACT_TAIL, {
    version: CONTRACT_VERSION,
    functionName: "store",
    input: policy,
  });
  return res; // { stored: true }
}

/** Convert the indexer's camelCase history to the snake_case the Rust contract expects. */
export function toContractHistory(h) {
  return {
    created: h.created,
    delivered: h.delivered,
    released: h.released,
    refunded: h.refunded,
    rejections: h.rejections,
    expired: h.expired,
    delivery_ratios: h.delivery_ratios ?? h.deliveryRatios ?? [],
  };
}

/**
 * Ask the TEE contract: "is this agent acceptable under my policy?"
 * `history` is the PUBLIC on-chain history (from src/indexer.js).
 * The contract reads the sealed policy, computes the score in-enclave, and
 * returns only { acceptable, grade, score, answers } — never the policy.
 */
export async function checkAgent(tenant, agent, history) {
  const result = await tenant.contracts.execute(CONTRACT_TAIL, {
    version: CONTRACT_VERSION,
    functionName: "check",
    input: { agent, history: toContractHistory(history) },
  });
  return result;
}

/** Register the compiled escrow-trust WASM component as a tenant contract. */
export async function registerContract(tenant, wasmBytes) {
  const reg = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmBytes,
  });
  return reg; // { name: "z:<tid>:escrow-trust", contract_id: number }
}

/** Tamper-evident activity log for this tenant (audit trail). */
export async function getActivityLog(client, page = 1) {
  return client.getActivityLog({ page });
}
