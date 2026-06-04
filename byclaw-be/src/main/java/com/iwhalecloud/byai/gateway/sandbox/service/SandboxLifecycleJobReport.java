package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Lifecycle job execution summary for logging and troubleshooting.
 */
public class SandboxLifecycleJobReport {

    private static final int MAX_SANDBOX_SAMPLES = 20;

    private final String jobName;
    private int totalCandidates;
    private int scannedCount;
    private int affectedCount;
    private int skippedCount;
    private int failedCount;
    private final List<String> affectedSandboxes = new ArrayList<>();
    private final List<String> skippedSandboxes = new ArrayList<>();
    private final List<String> failedSandboxes = new ArrayList<>();

    public SandboxLifecycleJobReport(String jobName) {
        this.jobName = jobName;
    }

    public String getJobName() {
        return jobName;
    }

    public int getTotalCandidates() {
        return totalCandidates;
    }

    public void setTotalCandidates(int totalCandidates) {
        this.totalCandidates = totalCandidates;
    }

    public int getScannedCount() {
        return scannedCount;
    }

    public void addScannedCount(int count) {
        this.scannedCount += count;
    }

    public int getAffectedCount() {
        return affectedCount;
    }

    public int getSkippedCount() {
        return skippedCount;
    }

    public int getFailedCount() {
        return failedCount;
    }

    public List<String> getAffectedSandboxes() {
        return Collections.unmodifiableList(affectedSandboxes);
    }

    public List<String> getSkippedSandboxes() {
        return Collections.unmodifiableList(skippedSandboxes);
    }

    public List<String> getFailedSandboxes() {
        return Collections.unmodifiableList(failedSandboxes);
    }

    public void addAffectedSandbox(String sandboxRef) {
        affectedCount++;
        addSample(affectedSandboxes, sandboxRef);
    }

    public void addSkippedSandbox(String sandboxRef) {
        skippedCount++;
        addSample(skippedSandboxes, sandboxRef);
    }

    public void addFailedSandbox(String sandboxRef) {
        failedCount++;
        addSample(failedSandboxes, sandboxRef);
    }

    public void merge(SandboxLifecycleJobReport other) {
        if (other == null) {
            return;
        }
        totalCandidates += other.totalCandidates;
        scannedCount += other.scannedCount;
        affectedCount += other.affectedCount;
        skippedCount += other.skippedCount;
        failedCount += other.failedCount;
        other.affectedSandboxes.forEach(item -> addSample(affectedSandboxes, item));
        other.skippedSandboxes.forEach(item -> addSample(skippedSandboxes, item));
        other.failedSandboxes.forEach(item -> addSample(failedSandboxes, item));
    }

    private void addSample(List<String> samples, String sandboxRef) {
        if (sandboxRef != null && samples.size() < MAX_SANDBOX_SAMPLES) {
            samples.add(sandboxRef);
        }
    }
}
