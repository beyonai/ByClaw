package com.iwhalecloud.byai.common.quota;

/** Validated LIMITED package; decimal revisions remain strings across language boundaries. */
public record QuotaSnapshot(long enterpriseId, String revision, int memberLimit, int groupLimit,
                            int groupMemberLimit, int agentLimit, String accessMode,
                            java.time.OffsetDateTime effectiveFrom, java.time.OffsetDateTime effectiveTo) {
    public QuotaSnapshot(long enterpriseId, String revision, int memberLimit, int groupLimit, int groupMemberLimit, int agentLimit) {
        this(enterpriseId, revision, memberLimit, groupLimit, groupMemberLimit, agentLimit, null, null, null);
    }
    public boolean commerciallyEffective() {
        var now = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC);
        return "ENABLED".equals(accessMode) && effectiveFrom != null && effectiveTo != null
            && !now.isBefore(effectiveFrom) && now.isBefore(effectiveTo);
    }
}
