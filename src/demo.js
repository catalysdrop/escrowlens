// Labelled demo fixtures — archetype agent histories used by:
//  - `GET /api/trust/:agent?demo=1` (clearly labelled DEMO in the UI + API)
//  - the unit tests in test/scorer.test.js
//  - the demo video, until more real on-chain history exists.
//
// These are NOT real agents. Real chain data always wins: the server only
// serves a fixture when the caller explicitly asks for demo mode.

// The one REAL agent history on record (verified live 24 Nov 2026):
// 0x3cb5d9c8da9f936a2fd042464f858b4f8910bc47 — 2 escrows (one on each
// AgentEscrow deployment), 0.5 tUSD8 each, both deadlines passed 23 Nov 2026
// with zero deliveries. Scores ~6.9/100, grade D.
export const REAL_GHOST_AGENT = "0x3cb5d9c8da9f936a2fd042464f858b4f8910bc47";

export const DEMO_AGENTS = {
  // A reliable agent: 5 jobs, all delivered fast, all released, no disputes.
  perfect: {
    label: "Reliable agent (fixture)",
    address: "0x0000000000000000000000000000000000000001",
    history: {
      created: 5,
      delivered: 5,
      released: 5,
      refunded: 0,
      rejections: 0,
      expired: 0,
      deliveryRatios: [0.08, 0.12, 0.1, 0.15, 0.09],
    },
  },
  // A mixed agent: some releases, one refund, one rejected delivery, slow.
  disputed: {
    label: "Disputed agent (fixture)",
    address: "0x0000000000000000000000000000000000000002",
    history: {
      created: 5,
      delivered: 3,
      released: 2,
      refunded: 1,
      rejections: 1,
      expired: 1,
      deliveryRatios: [0.7, 0.8, 0.9],
    },
  },
  // The real ghost agent, as indexed from chain (same numbers as live data).
  ghost: {
    label: "Ghost agent — REAL on-chain history (v1 + v2)",
    address: REAL_GHOST_AGENT,
    history: {
      created: 2,
      delivered: 0,
      released: 0,
      refunded: 0,
      rejections: 0,
      expired: 2,
      deliveryRatios: [],
    },
  },
  // A brand-new agent with no history at all.
  fresh: {
    label: "New agent (fixture)",
    address: "0x0000000000000000000000000000000000000003",
    history: {
      created: 0,
      delivered: 0,
      released: 0,
      refunded: 0,
      rejections: 0,
      expired: 0,
      deliveryRatios: [],
    },
  },
};

export function demoFor(address) {
  const lower = (address ?? "").toLowerCase();
  for (const demo of Object.values(DEMO_AGENTS)) {
    if (demo.address.toLowerCase() === lower) return demo;
  }
  return null;
}
