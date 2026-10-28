package com.iwhalecloud.byai.common.quota;

/** Validated LIMITED package; decimal revisions remain strings across language boundaries. */
public record QuotaSnapshot(long enterpriseId, String revision, int memberLimit, int groupLimit,
                            int groupMemberLimit, int agentLimit) { }
