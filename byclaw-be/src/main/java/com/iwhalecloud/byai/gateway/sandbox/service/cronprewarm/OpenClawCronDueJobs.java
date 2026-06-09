package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.util.Collections;
import java.util.List;

public class OpenClawCronDueJobs {

    public enum Status {
        READY,
        MISSING_TABLE,
        MISSING_COLUMNS
    }

    private final Status status;

    private final List<OpenClawCronDueJob> jobs;

    private final List<String> missingColumns;

    private OpenClawCronDueJobs(Status status, List<OpenClawCronDueJob> jobs, List<String> missingColumns) {
        this.status = status;
        this.jobs = jobs;
        this.missingColumns = missingColumns;
    }

    public static OpenClawCronDueJobs ready(List<OpenClawCronDueJob> jobs) {
        return new OpenClawCronDueJobs(Status.READY, jobs, Collections.emptyList());
    }

    public static OpenClawCronDueJobs missingTable() {
        return new OpenClawCronDueJobs(Status.MISSING_TABLE, Collections.emptyList(), Collections.emptyList());
    }

    public static OpenClawCronDueJobs missingColumns(List<String> columns) {
        return new OpenClawCronDueJobs(Status.MISSING_COLUMNS, Collections.emptyList(), columns);
    }

    public Status getStatus() {
        return status;
    }

    public List<OpenClawCronDueJob> getJobs() {
        return jobs;
    }

    public List<String> getMissingColumns() {
        return missingColumns;
    }
}
