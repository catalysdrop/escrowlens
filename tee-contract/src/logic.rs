//! Pure trust-scoring logic for the EscrowLens TEE contract.
//!
//! No host calls in this file: it is unit-testable natively with `cargo test`
//! and mirrors `escrowlens/src/scorer.js` exactly (same weights, same bands).
//! If you change a weight here, change it in `src/scorer.js` too.

use serde::{Deserialize, Serialize};

/// A customer's private hiring policy. Sealed in the tenant map; never
/// returned to any caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    /// Minimum acceptable trust score (0–100).
    pub min_score: f64,
    /// Maximum acceptable dispute rate, in basis points (100 = 1%).
    /// Disputes = delivery rejections + refunds, over escrows created.
    pub max_dispute_rate_bps: u64,
    /// Agent addresses (lowercase 0x…) the customer never hires.
    #[serde(default)]
    pub blocked_agents: Vec<String>,
    /// If true, an agent with zero deliveries is never acceptable.
    #[serde(default = "default_true")]
    pub require_delivery: bool,
}

fn default_true() -> bool {
    true
}

/// Public on-chain history for one agent (as supplied in the `check` input).
/// Same shape as the history object built by `src/indexer.js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub created: u64,
    pub delivered: u64,
    pub released: u64,
    pub refunded: u64,
    pub rejections: u64,
    pub expired: u64,
    #[serde(default)]
    pub delivery_ratios: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breakdown {
    pub completion: f64,
    pub reliability: f64,
    pub speed: f64,
    pub experience: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Score {
    pub score: f64,
    pub grade: String,
    pub breakdown: Breakdown,
}

fn round1(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}

fn grade_for(score: f64) -> String {
    if score >= 80.0 {
        "A".to_string()
    } else if score >= 60.0 {
        "B".to_string()
    } else if score >= 40.0 {
        "C".to_string()
    } else {
        "D".to_string()
    }
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        Some(sorted[mid])
    } else {
        Some((sorted[mid - 1] + sorted[mid]) / 2.0)
    }
}

/// Score one agent. Returns None when there is no usable history —
/// we never fabricate a score for an unknown agent.
pub fn score_history(h: &History) -> Option<Score> {
    let closed = h.released + h.refunded + h.expired;
    if h.created == 0 || closed == 0 {
        return None;
    }

    // Completion (40): share of closed escrows that paid the agent.
    let completion = (h.released as f64 / closed as f64) * 40.0;

    // Reliability (25): share of delivery attempts the client did not reject.
    // An agent that never delivered has no attempts -> 0, not a free pass.
    let attempts = h.delivered + h.rejections;
    let reliability = if attempts == 0 {
        0.0
    } else {
        (1.0 - h.rejections as f64 / attempts as f64) * 25.0
    };

    // Speed (20): median delivery time as a fraction of the allowed time.
    let speed = match median(&h.delivery_ratios) {
        Some(med) => 20.0 * (1.0 - med).clamp(0.0, 1.0),
        None => 0.0,
    };

    // Experience (15): log-scaled closed-escrow count, full at 10 closed.
    let experience = 15.0 * ((1.0 + closed as f64).ln() / 11.0f64.ln()).min(1.0);

    let score = round1(completion + reliability + speed + experience);
    Some(Score {
        grade: grade_for(score),
        score,
        breakdown: Breakdown {
            completion: round1(completion),
            reliability: round1(reliability),
            speed: round1(speed),
            experience: round1(experience),
        },
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evaluation {
    pub acceptable: bool,
    pub score: Option<f64>,
    pub grade: Option<String>,
    pub answers: Answers,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answers {
    pub meets_min_score: bool,
    pub within_dispute_limit: bool,
    pub not_blocked: bool,
    pub has_deliveries: bool,
}

/// Evaluate one agent against a sealed policy. Only booleans, a score and a
/// grade come back — never the policy itself.
pub fn evaluate(policy: &Policy, agent: &str, history: &History) -> Evaluation {
    let score = score_history(history);
    let agent_lc = agent.to_lowercase();

    let meets_min_score = score
        .as_ref()
        .map(|s| s.score >= policy.min_score)
        .unwrap_or(false);
    let disputes = history.rejections + history.refunded;
    let dispute_rate_bps = if history.created == 0 {
        0
    } else {
        disputes * 10_000 / history.created
    };
    let within_dispute_limit = dispute_rate_bps <= policy.max_dispute_rate_bps;
    let not_blocked = !policy
        .blocked_agents
        .iter()
        .any(|b| b.to_lowercase() == agent_lc);
    let has_deliveries = history.delivered > 0;
    let delivery_ok = !policy.require_delivery || has_deliveries;

    Evaluation {
        acceptable: meets_min_score
            && within_dispute_limit
            && not_blocked
            && delivery_ok,
        score: score.as_ref().map(|s| s.score),
        grade: score.as_ref().map(|s| s.grade.clone()),
        answers: Answers {
            meets_min_score,
            within_dispute_limit,
            not_blocked,
            has_deliveries,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perfect() -> History {
        History {
            created: 5,
            delivered: 5,
            released: 5,
            refunded: 0,
            rejections: 0,
            expired: 0,
            delivery_ratios: vec![0.08, 0.12, 0.10, 0.15, 0.09],
        }
    }

    #[test]
    fn perfect_agent_scores_a() {
        let s = score_history(&perfect()).expect("scored");
        assert!(s.score >= 80.0, "score {} < 80", s.score);
        assert_eq!(s.grade, "A");
    }

    #[test]
    fn ghost_agent_scores_d() {
        // The real on-chain history: 2 escrows, 0 deliveries, both expired.
        let ghost = History {
            created: 2,
            delivered: 0,
            released: 0,
            refunded: 0,
            rejections: 0,
            expired: 2,
            delivery_ratios: vec![],
        };
        let s = score_history(&ghost).expect("scored");
        assert!(s.score < 40.0, "score {} >= 40", s.score);
        assert_eq!(s.grade, "D");
    }

    #[test]
    fn no_history_is_none() {
        let fresh = History {
            created: 0,
            delivered: 0,
            released: 0,
            refunded: 0,
            rejections: 0,
            expired: 0,
            delivery_ratios: vec![],
        };
        assert!(score_history(&fresh).is_none());
    }
}
