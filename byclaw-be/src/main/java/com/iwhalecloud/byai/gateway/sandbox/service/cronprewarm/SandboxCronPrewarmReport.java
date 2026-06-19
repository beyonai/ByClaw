package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SandboxCronPrewarmReport {

    private static final int MAX_DETAIL_COUNT = 20;

    private int scannedUsers;

    private int missingDbUsers;

    private int missingTableUsers;

    private int missingColumnUsers;

    private int dueJobs;

    private int candidateTargets;

    private int activeSkipped;

    private int launched;

    private int failed;

    private final List<String> launchedTargets = new ArrayList<>();

    private final List<String> skippedTargets = new ArrayList<>();

    private final List<String> failedTargets = new ArrayList<>();

    public int getScannedUsers() {
        return scannedUsers;
    }

    public int getMissingDbUsers() {
        return missingDbUsers;
    }

    public int getMissingTableUsers() {
        return missingTableUsers;
    }

    public int getMissingColumnUsers() {
        return missingColumnUsers;
    }

    public int getDueJobs() {
        return dueJobs;
    }

    public int getCandidateTargets() {
        return candidateTargets;
    }

    public int getActiveSkipped() {
        return activeSkipped;
    }

    public int getLaunched() {
        return launched;
    }

    public int getFailed() {
        return failed;
    }

    public List<String> getLaunchedTargets() {
        return Collections.unmodifiableList(launchedTargets);
    }

    public List<String> getSkippedTargets() {
        return Collections.unmodifiableList(skippedTargets);
    }

    public List<String> getFailedTargets() {
        return Collections.unmodifiableList(failedTargets);
    }

    void incrementScannedUsers() {
        scannedUsers++;
    }

    void incrementMissingDbUsers() {
        missingDbUsers++;
    }

    void incrementMissingTableUsers() {
        missingTableUsers++;
    }

    void incrementMissingColumnUsers() {
        missingColumnUsers++;
    }

    void addDueJobs(int count) {
        dueJobs += count;
    }

    void addCandidateTargets(int count) {
        candidateTargets += count;
    }

    void addActiveSkipped(String target) {
        activeSkipped++;
        addDetail(skippedTargets, target);
    }

    void addLaunched(String target) {
        launched++;
        addDetail(launchedTargets, target);
    }

    void addFailed(String target) {
        failed++;
        addDetail(failedTargets, target);
    }

    private void addDetail(List<String> details, String detail) {
        if (details.size() < MAX_DETAIL_COUNT) {
            details.add(detail);
        }
    }
}
