# EscrowLens — Trust scores for AI agents

> "Can I trust this agent with my money?" — answered from on-chain evidence,
> with the scoring policy sealed inside a Terminal 3 TEE contract.

EscrowLens reads the escrow history of any AI agent from the
[AgentEscrow](https://github.com/catalysdrop/agent-escrow) contracts on QDay Aevum
testnet and turns it into a **0–100 trust score + grade + evidence breakdown**.
A client can also store a **private hiring policy** (minimum score, blocked agents,
max dispute rate) in their Terminal 3 tenant; an agent asking "is this hire OK?"
only ever gets back yes/no answers and a score band — it never sees the policy.

Built for the **Terminal 3 Build+Scale Agent Micro Grant** (DoraHacks, closes
24 Dec 2026). Judging is 80% traction + 20% visibility, so this is a free public
tool: no signup, no wallet, paste an address, get a score card.

## How it works

```
AgentEscrow events (Aevum testnet, v1 + v2)
        │  eth_getLogs, paged in 1000-block chunks (RPC limit)
        ▼
src/indexer.js ── decodes EscrowCreated / Delivered / DeliveryRejected /
                   Released / Refunded, then calls escrowOf() per taskId
                   for current status + deliveredAt
        │
        ▼
src/scorer.js ── pure function: history → score 0–100 + grade + signals
        │         completion 40 · reliability 25 · speed 20 · experience 15
        ▼
src/server.js ── dashboard + JSON API (/api/trust/:agent, /api/leaderboard)
        │
        ▼ (Phase 2)
src/t3/ + tee-contract/ ── the same scoring, inside a T3 TEE contract:
        policy sealed in a tenant map (z-namespace), agent gets yes/no only
```

## Quickstart (core — zero dependencies, Node ≥ 18)

```bash
node --test test/scorer.test.js   # unit tests, 6/6 (scorer incl. real ghost-agent history)
node src/indexer.js --print   # sync live escrow history from Aevum, print JSON
node src/server.js       # dashboard at http://localhost:3000
```

## Verified live data (25 Nov 2026 — Phase 3 demo)

**5 escrows / 13 events** indexed across both AgentEscrow deployments (v1 +
v2), all 0.5 tUSD8 on QDay Aevum testnet:

| Agent | Escrows | Delivered | Released | Refunded | Score | Grade |
|---|---|---|---|---|---|---|
| Demo agent `0xc2C2325a…2663` | 3 | 2 | 2 | 1 | 71.6 | B |
| Ghost agent `0x3cb5d9c8…bc47` | 2 | 0 | 0 | 1 (+1 expired) | 6.9 | D |

Demo paths covered on-chain (25 Nov 2026, testnet only): happy path
create → deliver → release; refund path (no delivery before deadline);
reject path (deliver → reject → deliver → release). The original v2 escrow
(`0x30795865…4f4f6`) was refunded to the deployer. The dashboard shows real
chain data when present; `?demo=1` serves clearly-labelled fixture archetypes
so the UI is demonstrable before more history exists.

## Demo video

[escrowlens-demo.mp4](demo-video/escrowlens-demo.mp4) — 2:06, 1920×1080,
English narration. Six slides: the problem, the live dashboard, the demo-agent
trust card (71.6/B), the ghost-agent trust card (6.9/D), the TEE contract +
policy, and closing. (YouTube upload pending.)

RPC note: Aevum `eth_getLogs` rejects ranges over 1000 blocks
(`-32000 block range too large`). The indexer pages accordingly. In sandboxed
shells where Node `fetch` ignores the egress proxy, use `curl` for manual checks
(see `src/indexer.js` header).

## Phase 2 — Terminal 3 ✅ LIVE (24–25 Nov 2026)

TEE contract registered: **`z:11d4bb95e448f0096778ed4f92d00d1cd969d722:escrow-trust`**,
contract_id **1150**, v0.1.0 (WASM 202,440 bytes, sha256
`d6121975cc4061151e94b4739ac4b35b3ec4818422893b8bb6fbadffb24c3462`).
Org `EscrowLens` (`did:t3n:4d2fe40c9f93f736474f5f45f606af876947b3c1`), tenant
`did:t3n:11d4bb95e448f0096778ed4f92d00d1cd969d722`. Policy map `trust-policies`
(readers/writers: contract 1150 only); stored policy: min_score 60,
max_dispute_rate_bps 2000, require_delivery true. A live `check` on the ghost
agent inside the TEE returns **6.9 / D, acceptable: false — identical to the
local scorer**.

To reproduce the setup:

1. Claim a key + test credits (self-serve, free): https://www.terminal3.io/claim-page
   — sign in with a work email; also create an organisation (required even solo).
2. `npm install @terminal3/t3n-sdk` (listed as an optional dependency).
3. Install the Rust toolchain + `wasm32-wasip2` target; vendor `tee-contract/wit/deps`
   from https://github.com/Terminal-3/agent-vault-starter (host interfaces
   `host:interfaces@2.4.0`, `host:tenant@2.0.0`).
4. `cargo test` in `tee-contract/`, then build the WASM component and register it
   via `tenant.contracts.register()` — see `tee-contract/README.md`.
5. Set `T3N_PRIVATE_KEY` in the environment (never in a file) and run the
   `src/t3/client.js` flow: authenticate → policy map → `checkAgent()`.

T3 credits consumed during the program are covered by Terminal 3.

## API

- `GET /` — dashboard
- `GET /api/trust/:agent` — `{ agent, score, grade, breakdown, counts, signals,
  evidence, source: "chain" | "demo", updatedAt }`
- `GET /api/leaderboard` — top agents by score (min. 1 closed escrow)
- `GET /api/health` — `{ ok, chain, contracts, eventsIndexed, lastSync }`

## Scoring

| Component | Weight | Meaning |
|---|---|---|
| Completion | 40 | released / closed escrows (closed = released + refunded + expired) |
| Reliability | 25 | 1 − delivery rejections / delivery attempts (0 if never delivered) |
| Speed | 20 | 1 − median(delivery time / allowed time) across delivered escrows |
| Experience | 15 | log-scaled closed-escrow count, full at 10 |

Grades: A ≥ 80, B ≥ 60, C ≥ 40, else D. No history → `score: null`,
`"insufficient data"` — never a fabricated score.

## Submission checklist

- [x] Core running + tests green (6/6)
- [x] TEE contract built, registered (id 1150), `checkAgent()` verified on T3 sandbox
- [x] Demo escrows seeded on AgentEscrow v2 (full lifecycle on video)
- [x] Demo video (2:06)
- [ ] Repo public on GitHub + DoraHacks submission (repo link + video)
- [ ] Traction push: X posts with score cards, weekly mentions until 24 Dec

## License

MIT — see `LICENSE`.
