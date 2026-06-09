package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

public class OpenClawCronDueJob {

    private final String jobId;

    private final Long nextRunAtMs;

    private final String agentId;

    private final String sessionKey;

    private final String sessionTarget;

    private final String payloadKind;

    public OpenClawCronDueJob(String jobId, Long nextRunAtMs, String agentId, String sessionKey,
        String sessionTarget, String payloadKind) {
        this.jobId = jobId;
        this.nextRunAtMs = nextRunAtMs;
        this.agentId = agentId;
        this.sessionKey = sessionKey;
        this.sessionTarget = sessionTarget;
        this.payloadKind = payloadKind;
    }

    public String getJobId() {
        return jobId;
    }

    public Long getNextRunAtMs() {
        return nextRunAtMs;
    }

    public String getAgentId() {
        return agentId;
    }

    public String getSessionKey() {
        return sessionKey;
    }

    public String getSessionTarget() {
        return sessionTarget;
    }

    public String getPayloadKind() {
        return payloadKind;
    }
}
