package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.ArrayList;
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
    private int cancelledGroups;
    private int inFlightGroups;
    private final List<String> affectedSandboxes = new ArrayList<>();
    private final List<String> skippedSandboxes = new ArrayList<>();
    private final List<String> failedSandboxes = new ArrayList<>();

    public SandboxLifecycleJobReport(String jobName) {
        this.jobName = jobName;
    }

    public String getJobName() {
        return jobName;
    }

    public synchronized int getTotalCandidates() {
        return totalCandidates;
    }

    public synchronized void setTotalCandidates(int totalCandidates) {
        this.totalCandidates = totalCandidates;
    }

    public synchronized int getScannedCount() {
        return scannedCount;
    }

    public synchronized void addScannedCount(int count) {
        this.scannedCount += count;
    }

    public synchronized int getAffectedCount() {
        return affectedCount;
    }

    public synchronized int getSkippedCount() {
        return skippedCount;
    }

    public synchronized int getFailedCount() {
        return failedCount;
    }

    public synchronized List<String> getAffectedSandboxes() {
        return List.copyOf(affectedSandboxes);
    }

    public synchronized List<String> getSkippedSandboxes() {
        return List.copyOf(skippedSandboxes);
    }

    public synchronized List<String> getFailedSandboxes() {
        return List.copyOf(failedSandboxes);
    }

    public synchronized void addAffectedSandbox(String sandboxRef) {
        affectedCount++;
        addSample(affectedSandboxes, sandboxRef);
    }

    public synchronized void addSkippedSandbox(String sandboxRef) {
        skippedCount++;
        addSample(skippedSandboxes, sandboxRef);
    }

    public synchronized void addFailedSandbox(String sandboxRef) {
        failedCount++;
        addSample(failedSandboxes, sandboxRef);
    }

    public synchronized int getCancelledGroups() { return cancelledGroups; }

    public synchronized int getInFlightGroups() { return inFlightGroups; }

    public synchronized void markCancelled() { cancelledGroups = 1; }

    public synchronized void markInFlight() { inFlightGroups = 1; }

    public synchronized SandboxLifecycleJobReport snapshot() {
        SandboxLifecycleJobReport copy = new SandboxLifecycleJobReport(jobName);
        copy.totalCandidates = totalCandidates;
        copy.scannedCount = scannedCount;
        copy.affectedCount = affectedCount;
        copy.skippedCount = skippedCount;
        copy.failedCount = failedCount;
        copy.cancelledGroups = cancelledGroups;
        copy.inFlightGroups = inFlightGroups;
        copy.affectedSandboxes.addAll(affectedSandboxes);
        copy.skippedSandboxes.addAll(skippedSandboxes);
        copy.failedSandboxes.addAll(failedSandboxes);
        return copy;
    }

    public void merge(SandboxLifecycleJobReport other) {
        if (other != null) {
            mergeSnapshot(other.snapshot());
        }
    }

    private synchronized void mergeSnapshot(SandboxLifecycleJobReport other) {
        if (other == null) {
            return;
        }
        totalCandidates += other.totalCandidates;
        scannedCount += other.scannedCount;
        affectedCount += other.affectedCount;
        skippedCount += other.skippedCount;
        failedCount += other.failedCount;
        cancelledGroups += other.cancelledGroups;
        inFlightGroups += other.inFlightGroups;
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
