# escrow-trust — TEE contract

Scores an agent's escrow history against a customer's **sealed** hiring
policy, inside a Terminal 3 TEE. The agent asking the question only ever
gets booleans + a score band back — it never sees the policy.

## Shape

Follows the official Terminal 3 "private customer vault" walkthrough
(docs.terminal3.io → *1. Write your TEE contract*):

- Rust crate compiled to a WASM **component** (`wit-bindgen` 0.49,
  `world escrow-trust`, `contracts` interface, `generic-input` envelope).
- `tenant-base` world only: `host:tenant/tenant-context@2.0.0`,
  `host:interfaces/logging@2.4.0`, `host:interfaces/kv-store@2.4.0`.
  No HTTP import — a sealed policy can never leave the enclave.
- Functions: `store` (customer saves policy, self only), `check`
  (customer or a granted agent asks; answers only), `forget`
  (customer deletes policy, self only).
- Policy rows are keyed by `hex(calling_user_did)` in map
  `z:<tid>:trust-policies` — an agent can only ever reach the customer
  who granted it, and `store`/`forget` refuse delegated calls.

## Files

| Path | What it is |
|---|---|
| `wit/world.wit` | The world + `contracts` interface |
| `wit/deps/` | **NOT vendored here** — copy from `github.com/Terminal-3/agent-vault-starter` (host interfaces `host:interfaces@2.4.0`, `host:tenant@2.0.0`, Trinity release `testnet-v1.0.12`) |
| `src/lib.rs` | wit-bindgen entry point + Guest impl (wasm32 only) |
| `src/logic.rs` | Pure scoring (no host calls) — same weights as `src/scorer.js` |
| `tests/logic.rs` | Native tests, run with `cargo test` |
| `examples/` | Sample history + policy JSON |

## Build (needs a Rust toolchain — not present in this sandbox)

```bash
# 1. Vendor the host interfaces
git clone https://github.com/Terminal-3/agent-vault-starter.git /tmp/agent-vault-starter
cp -r /tmp/agent-vault-starter/wit/deps wit/deps

# 2. Native unit tests (logic only, no WASM needed)
cargo test

# 3. Build the WASM component
rustup target add wasm32-wasip2
cargo install cargo-component
cargo component build --release --target wasm32-wasip2
# artifact: target/wasm32-wasip2/release/escrow_trust.wasm
```

## Register + invoke (from the Node app)

```js
import { connectTenant, registerContract, checkAgent } from "../src/t3/client.js";
import { readFileSync } from "node:fs";

const { tenant } = await connectTenant();
const wasm = readFileSync("target/wasm32-wasip2/release/escrow_trust.wasm");
const reg = await registerContract(tenant, wasm);
const answer = await checkAgent(tenant, reg.contract_id, reg.contract_version,
  "0x3cb5d9c8da9f936a2fd042464f858b4f8910bc47", history);
// → { acceptable: false, score: 6.9, grade: "D", answers: {...} }
```

## Rules this contract follows (from the T3 docs)

- Export functions on the `contracts` interface; each takes `generic-input`
  and returns `result<list<u8>, string>`.
- `kv-store` calls take the **full** `z:<tid>:<map>` name.
- Key data by `calling_user_did()`, never by a DID taken from the input.
- Return answers, not values; never put a value in a log line, an error,
  or a `custom` label.
- Import only the host interfaces you use.
