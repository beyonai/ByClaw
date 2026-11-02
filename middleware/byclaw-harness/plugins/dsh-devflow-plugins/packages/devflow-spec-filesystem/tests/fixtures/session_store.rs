// Original test data written for this repository, with no upstream source: one
// plausible file carrying every Rust item form the evaluator claims.

use std::collections::HashMap;
use std::collections::hash_map::Values;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

/// How long a recorded verdict is trusted before its anchor is evaluated again.
pub const VERDICT_TTL: Duration = Duration::from_secs(900);

/// Stores opened since the process booted, for the status line.
pub static STORES_OPENED: AtomicU64 = AtomicU64::new(0);

/// A verdict is filed under the document that carries the anchor and the
/// anchor's own id.
pub type VerdictKey = (String, String);

macro_rules! stale {
    ($reason:literal) => {
        Freshness::Stale {
            reason: $reason.to_string(),
        }
    };
}

/// What the store last observed about one anchor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Freshness {
    Fresh,
    Stale { reason: String },
    Unverifiable,
}

#[derive(Clone, Debug)]
pub struct VerdictRecord {
    pub key: VerdictKey,
    pub freshness: Freshness,
    pub observed_at: SystemTime,
}

/// The clock a store reads, so a test can hold time still.
pub trait Clock {
    type Instant;

    fn now(&self) -> Self::Instant;
}

/// The clock a running process reads.
pub struct SystemClock;

impl Clock for SystemClock {
    type Instant = SystemTime;

    fn now(&self) -> Self::Instant {
        SystemTime::now()
    }
}

#[derive(Debug, Default)]
pub struct SessionStore {
    records: HashMap<VerdictKey, VerdictRecord>,
    evictions: u64,
}

/// Whether `record` is still inside the trust window at `now`.
pub fn is_current(record: &VerdictRecord, now: SystemTime) -> bool {
    now.duration_since(record.observed_at)
        .map(|age| age < VERDICT_TTL)
        .unwrap_or(false)
}

/// The key one anchor of one document is filed under.
pub fn key_for(document_id: &str, anchor_id: &str) -> VerdictKey {
    (document_id.to_string(), anchor_id.to_string())
}

impl SessionStore {
    /// Room for a session's worth of anchors before the map grows.
    const CAPACITY_HINT: usize = 64;

    pub fn new() -> Self {
        STORES_OPENED.fetch_add(1, Ordering::Relaxed);
        Self {
            records: HashMap::with_capacity(Self::CAPACITY_HINT),
            evictions: 0,
        }
    }

    /// Files a verdict, returning the record it replaced.
    pub fn record(
        &mut self,
        key: VerdictKey,
        freshness: Freshness,
        now: SystemTime,
    ) -> Option<VerdictRecord> {
        let record = VerdictRecord {
            key: key.clone(),
            freshness,
            observed_at: now,
        };
        self.records.insert(key, record)
    }

    /// What to report without reading the repository again.
    pub fn freshness(&self, key: &VerdictKey, now: SystemTime) -> Freshness {
        match self.records.get(key) {
            Some(record) if is_current(record, now) => record.freshness.clone(),
            Some(_) => stale!("the recorded verdict aged out of its trust window"),
            None => Freshness::Unverifiable,
        }
    }

    /// Drops every record the trust window has left behind.
    pub fn evict_expired(&mut self, now: SystemTime) -> usize {
        let before = self.records.len();
        self.records.retain(|_, record| is_current(record, now));
        let dropped = before - self.records.len();
        self.evictions += dropped as u64;
        dropped
    }

    pub fn evictions(&self) -> u64 {
        self.evictions
    }
}

impl fmt::Display for Freshness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Freshness::Fresh => write!(f, "fresh"),
            Freshness::Stale { reason } => write!(f, "stale: {reason}"),
            Freshness::Unverifiable => write!(f, "unverifiable"),
        }
    }
}

impl<'a> IntoIterator for &'a SessionStore {
    type Item = &'a VerdictRecord;
    type IntoIter = Values<'a, VerdictKey, VerdictRecord>;

    fn into_iter(self) -> Self::IntoIter {
        self.records.values()
    }
}

mod trust_window {
    use super::VERDICT_TTL;

    /// The window in whole seconds, which is how the command plane prints it.
    pub fn seconds() -> u64 {
        VERDICT_TTL.as_secs()
    }
}
