# Terminal 3 integration (Phase 2)

## The idea in one paragraph

The trust **score** is computed from public on-chain history, so anyone can
recompute it. What must stay private is the customer's **hiring policy**:
minimum score, blocked agents, max dispute rate. That policy lives sealed in
the customer's tenant map (`z:<tid>:trust-policies`). The TEE contract
(`tee-contract/`) reads the policy in-enclave, scores the history supplied in
the input, and answers only **yes/no + a score band**. An agent asking
"can I hire 0x…?" never sees the policy — exactly the Terminal 3 pattern from
the official "private customer vault" walkthrough (`store` / `check` /
`forget`), with a trust policy instead of a KYC record.

## Before first use (user-side, ~15 min)

1. Claim a key + test credits (self-serve, free):
   https://www.terminal3.io/claim-page — sign in with a work email.
2. Create an organisation (required even when working solo) — see
   https://docs.terminal3.io/developers/adk/get-started/create-organisation.md
3. `npm install @terminal3/t3n-sdk`
4. Export the key in your shell (never in a file, never committed):
   `export T3N_PRIVATE_KEY="0x..."` — the private key of the ETH wallet you
   registered with Terminal 3. It is used locally to sign the SIWE login
   challenge and never leaves your machine.

## TEE contract

See `../tee-contract/README.md`. Build it with the Rust toolchain
(`wasm32-wasip2` target), register it with `tenant.contracts.register()`
(`registerContract()` in `client.js`), then call it with `checkAgent()`.

## Key facts from the ADK docs (verified 24 Nov 2026)

- SDK: `@terminal3/t3n-sdk` (v5.41.0); stateless calls live in
  `@terminal3/t3n-client` (re-exported, same import names).
- `T3nClient.authenticate()` signs in with your Ethereum wallet (SIWE) and
  opens an encrypted channel to the TEE node; your `tenantDid` comes back
  from that call.
- `tenant.maps.create()` creates key-value maps under your private
  `z:<tid>:…` prefix, with explicit `readers`/`writers` rules.
- `tenant.contracts.register()` uploads a Rust→WASM contract; invoking uses
  `executeAndDecode()` with `contract_id` / `contract_version` /
  `function_name` / `input`.
- Every read/write is checked against your tenant prefix inside T3N.
- An **agent** making calls on its own needs its **own** key and its **own**
  test credits — do not reuse the developer's key.
- T3 credits consumed during the grant period are covered by Terminal 3.
