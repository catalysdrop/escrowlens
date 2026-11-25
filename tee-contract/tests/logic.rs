//! Native tests for the scoring logic (run with `cargo test`).
//! These mirror test/scorer.test.js — the same cases, the same expectations.

use escrow_trust::logic::{evaluate, score_history, History, Policy};

fn policy() -> Policy {
    Policy {
        min_score: 60.0,
        max_dispute_rate_bps: 2_000, // 20%
        blocked_agents: vec![],
        require_delivery: true,
    }
}

#[test]
fn perfect_agent_is_acceptable() {
    let h = History {
        created: 5,
        delivered: 5,
        released: 5,
        refunded: 0,
        rejections: 0,
        expired: 0,
        delivery_ratios: vec![0.08, 0.12, 0.10, 0.15, 0.09],
    };
    let ev = evaluate(&policy(), "0x0000000000000000000000000000000000000001", &h);
    assert!(ev.acceptable);
    assert_eq!(ev.grade.as_deref(), Some("A"));
}

#[test]
fn ghost_agent_is_rejected() {
    // Real on-chain history: 2 escrows, 0 deliveries, both expired.
    let h = History {
        created: 2,
        delivered: 0,
        released: 0,
        refunded: 0,
        rejections: 0,
        expired: 2,
        delivery_ratios: vec![],
    };
    let ev = evaluate(
        &policy(),
        "0x3cb5d9c8da9f936a2fd042464f858b4f8910bc47",
        &h,
    );
    assert!(!ev.acceptable);
    assert_eq!(ev.grade.as_deref(), Some("D"));
    assert!(!ev.answers.has_deliveries);
}

#[test]
fn blocked_agent_is_rejected_even_with_a_good_score() {
    let mut p = policy();
    p.blocked_agents = vec!["0x0000000000000000000000000000000000000001".to_string()];
    let h = History {
        created: 5,
        delivered: 5,
        released: 5,
        refunded: 0,
        rejections: 0,
        expired: 0,
        delivery_ratios: vec![0.1],
    };
    let ev = evaluate(&p, "0x0000000000000000000000000000000000000001", &h);
    assert!(!ev.acceptable);
    assert!(!ev.answers.not_blocked);
}

#[test]
fn fresh_agent_has_no_score() {
    let h = History {
        created: 0,
        delivered: 0,
        released: 0,
        refunded: 0,
        rejections: 0,
        expired: 0,
        delivery_ratios: vec![],
    };
    assert!(score_history(&h).is_none());
}
