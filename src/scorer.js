// Trust scoring — pure function, no I/O, no network.
// The SAME weights and bands are implemented in tee-contract/src/logic.rs;
// change them in both places (or the TEE score and the local score diverge).
//
// Input history (per agent), built by src/indexer.js from on-chain events:
// {
//   created: number,        // EscrowCreated events naming this agent
//   delivered: number,      // Delivered events (markDelivered calls)
//   released: number,       // Released events (paid: confirmRelease or claimUnconfirmed)
//   refunded: number,       // Refunded events (deadline passed, never delivered)
//   rejections: number,     // DeliveryRejected events (client rejected a delivery)
//   expired: number,        // escrows whose deadline passed, status still Created,
//                           // deliveredAt == 0 (took the job, never delivered)
//   deliveryRatios: number[] // per delivered escrow: (deliveredAt-createdAt)/(deadline-createdAt)
// }

export const WEIGHTS = {
  completion: 40,
  reliability: 25,
  speed: 20,
  experience: 15,
};

export function gradeFor(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Score one agent. Returns null (as { score: null, ... }) when there is no
 * usable history — we never fabricate a score for an unknown agent.
 */
export function scoreAgent(h) {
  const counts = {
    created: h.created ?? 0,
    delivered: h.delivered ?? 0,
    released: h.released ?? 0,
    refunded: h.refunded ?? 0,
    rejections: h.rejections ?? 0,
    expired: h.expired ?? 0,
  };
  const closed = counts.released + counts.refunded + counts.expired;

  if (counts.created === 0) {
    return {
      score: null,
      grade: null,
      insufficient: true,
      reason: "no escrow history on record",
      breakdown: null,
      counts,
      signals: ["No escrow history found for this agent."],
    };
  }
  if (closed === 0) {
    return {
      score: null,
      grade: null,
      insufficient: true,
      reason: "no closed escrows yet",
      breakdown: null,
      counts,
      signals: [
        `${counts.created} escrow(s) open, none closed yet — too early to score.`,
      ],
    };
  }

  // Completion: share of closed escrows that actually paid the agent.
  const completion = (counts.released / closed) * WEIGHTS.completion;

  // Reliability: share of delivery attempts the client did NOT reject.
  // An agent that never delivered has no delivery attempts → 0, not a free pass.
  const attempts = counts.delivered + counts.rejections;
  const reliability =
    attempts === 0
      ? 0
      : (1 - counts.rejections / attempts) * WEIGHTS.reliability;

  // Speed: median delivery time as a fraction of the allowed time.
  // Delivering in 10% of the allowed window scores ~18/20; using the full
  // window scores ~0. No deliveries → 0.
  let speed = 0;
  const med = median(h.deliveryRatios ?? []);
  if (med !== null) {
    speed = WEIGHTS.speed * Math.max(0, Math.min(1, 1 - med));
  }

  // Experience: log-scaled closed-escrow count, full marks at 10 closed.
  const experience =
    WEIGHTS.experience * Math.min(1, Math.log(1 + closed) / Math.log(11));

  const score = round1(completion + reliability + speed + experience);
  const grade = gradeFor(score);

  const signals = [];
  if (counts.released > 0)
    signals.push(
      `${counts.released}/${closed} closed escrow(s) released to the agent.`,
    );
  if (counts.refunded > 0)
    signals.push(
      `${counts.refunded} escrow(s) refunded — deadline passed with no delivery.`,
    );
  if (counts.expired > 0)
    signals.push(
      `${counts.expired} escrow(s) expired unresolved — job taken, never delivered.`,
    );
  if (counts.rejections > 0)
    signals.push(
      `${counts.rejections} deliver(ies) rejected by the client.`,
    );
  if (med !== null)
    signals.push(
      `Median delivery used ${Math.round(med * 100)}% of the allowed time.`,
    );
  if (counts.created === 1)
    signals.push("Only 1 escrow on record — score is low-confidence.");

  return {
    score,
    grade,
    insufficient: false,
    reason: null,
    breakdown: {
      completion: round1(completion),
      reliability: round1(reliability),
      speed: round1(speed),
      experience: round1(experience),
    },
    counts,
    signals,
  };
}

/** Score every agent in a { agentAddress: history } map. */
export function scoreAll(histories) {
  const out = {};
  for (const [agent, history] of Object.entries(histories)) {
    out[agent] = scoreAgent(history);
  }
  return out;
}
