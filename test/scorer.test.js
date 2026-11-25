// EscrowLens scorer tests — run with: node --test test/
// Zero dependencies (node:test + node:assert).
// The same cases exist as Rust tests in tee-contract/tests/logic.rs.

import test from "node:test";
import assert from "node:assert/strict";
import { scoreAgent } from "../src/scorer.js";
import { DEMO_AGENTS, REAL_GHOST_AGENT } from "../src/demo.js";

test("perfect agent scores A (>= 80)", () => {
  const r = scoreAgent(DEMO_AGENTS.perfect.history);
  assert.equal(r.insufficient, false);
  assert.equal(r.grade, "A");
  assert.ok(r.score >= 80, `score ${r.score} < 80`);
  assert.equal(r.breakdown.completion, 40);
  assert.equal(r.breakdown.reliability, 25);
});

test("disputed agent scores C (40–59)", () => {
  const r = scoreAgent(DEMO_AGENTS.disputed.history);
  assert.equal(r.insufficient, false);
  assert.equal(r.grade, "C");
  assert.ok(r.score >= 40 && r.score < 60, `score ${r.score} outside 40–59`);
  assert.ok(r.signals.some((s) => s.includes("rejected")));
});

test("ghost agent (real on-chain history) scores D (< 40)", () => {
  const r = scoreAgent(DEMO_AGENTS.ghost.history);
  assert.equal(r.insufficient, false);
  assert.equal(r.grade, "D");
  assert.ok(r.score < 40, `score ${r.score} >= 40`);
  assert.equal(r.breakdown.completion, 0);
  assert.equal(r.breakdown.reliability, 0);
  assert.equal(r.breakdown.speed, 0);
  assert.ok(r.signals.some((s) => s.includes("expired unresolved")));
});

test("ghost fixture matches the verified live agent address", () => {
  assert.equal(DEMO_AGENTS.ghost.address.toLowerCase(), REAL_GHOST_AGENT);
});

test("fresh agent returns insufficient, never a fake score", () => {
  const r = scoreAgent(DEMO_AGENTS.fresh.history);
  assert.equal(r.score, null);
  assert.equal(r.grade, null);
  assert.equal(r.insufficient, true);
  assert.equal(r.reason, "no escrow history on record");
});

test("agent with open escrows only is insufficient", () => {
  const r = scoreAgent({
    created: 2,
    delivered: 0,
    released: 0,
    refunded: 0,
    rejections: 0,
    expired: 0,
    deliveryRatios: [],
  });
  assert.equal(r.score, null);
  assert.equal(r.reason, "no closed escrows yet");
});
