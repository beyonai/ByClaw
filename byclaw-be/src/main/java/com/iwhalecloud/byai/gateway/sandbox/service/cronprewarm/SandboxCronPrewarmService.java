package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

@Service
public class SandboxCronPrewarmService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxCronPrewarmService.class);

    private final SandboxCronPrewarmProperties properties;

    private final SandboxCronPrewarmUserProvider userProvider;

    private final OpenClawStateSnapshotReader snapshotReader;

    private final OpenClawCronDueJobReader dueJobReader;

    private final SandboxCronPrewarmTargetResolver targetResolver;

    private final SsSandboxRecordMapper sandboxRecordMapper;

    private final SandboxService sandboxService;

    private final SandboxUserContextRunner userContextRunner;

    public SandboxCronPrewarmService(SandboxCronPrewarmProperties properties,
        SandboxCronPrewarmUserProvider userProvider, OpenClawStateSnapshotReader snapshotReader,
        OpenClawCronDueJobReader dueJobReader, SandboxCronPrewarmTargetResolver targetResolver,
        SsSandboxRecordMapper sandboxRecordMapper, SandboxService sandboxService,
        SandboxUserContextRunner userContextRunner) {
        this.properties = properties;
        this.userProvider = userProvider;
        this.snapshotReader = snapshotReader;
        this.dueJobReader = dueJobReader;
        this.targetResolver = targetResolver;
        this.sandboxRecordMapper = sandboxRecordMapper;
        this.sandboxService = sandboxService;
        this.userContextRunner = userContextRunner;
    }

    public SandboxCronPrewarmReport prewarmDueCronSandboxes() {
        SandboxCronPrewarmReport report = new SandboxCronPrewarmReport();
        List<String> userCodes = userProvider.listUserCodes();
        int launchesRemaining = properties.normalizedMaxLaunchesPerRun();

        for (String userCode : userCodes) {
            if (launchesRemaining <= 0) {
                break;
            }
            report.incrementScannedUsers();
            launchesRemaining -= scanUser(userCode, report, launchesRemaining);
        }

        return report;
    }

    private int scanUser(String userCode, SandboxCronPrewarmReport report, int launchesRemaining) {
        OpenClawStateSnapshot snapshot = null;
        try {
            snapshot = snapshotReader.snapshot(userCode);
            if (snapshot.isMissingDatabase()) {
                report.incrementMissingDbUsers();
                return 0;
            }
            OpenClawCronDueJobs dueJobs = dueJobReader.readDueJobs(snapshot.getDatabaseFile(),
                System.currentTimeMillis(), properties.getLookaheadMs(), properties.normalizedMaxJobsPerUser());
            if (dueJobs.getStatus() == OpenClawCronDueJobs.Status.MISSING_TABLE) {
                report.incrementMissingTableUsers();
                return 0;
            }
            if (dueJobs.getStatus() == OpenClawCronDueJobs.Status.MISSING_COLUMNS) {
                report.incrementMissingColumnUsers();
                LOGGER.warn("OpenClaw cron state DB columns are missing, userCode={}, columns={}", userCode,
                    dueJobs.getMissingColumns());
                return 0;
            }
            report.addDueJobs(dueJobs.getJobs().size());
            Set<SandboxCronPrewarmTarget> targets = resolveTargets(userCode, dueJobs.getJobs());
            report.addCandidateTargets(targets.size());
            return launchTargets(targets, report, launchesRemaining);
        }
        catch (Exception e) {
            if (snapshot != null) {
                snapshot.markFailed();
            }
            report.addFailed(userCode + "/snapshot");
            LOGGER.warn("OpenClaw cron prewarm scan failed, userCode={}", userCode, e);
            return 0;
        }
        finally {
            if (snapshot != null) {
                snapshot.close();
            }
        }
    }

    private Set<SandboxCronPrewarmTarget> resolveTargets(String userCode, List<OpenClawCronDueJob> dueJobs) {
        Set<SandboxCronPrewarmTarget> targets = new LinkedHashSet<>();
        for (OpenClawCronDueJob dueJob : dueJobs) {
            targets.add(targetResolver.resolve(userCode, dueJob));
        }
        return targets;
    }

    private int launchTargets(Set<SandboxCronPrewarmTarget> targets, SandboxCronPrewarmReport report,
        int launchesRemaining) {
        int launched = 0;
        for (SandboxCronPrewarmTarget target : targets) {
            if (launched >= launchesRemaining) {
                break;
            }
            String targetKey = target.toLogKey();
            try {
                SsSandboxRecord activeRecord = sandboxRecordMapper.selectActiveByUserAndResource(target.getUserCode(),
                    target.getServiceKey(), target.getResourceId());
                if (activeRecord != null) {
                    report.addActiveSkipped(targetKey);
                    continue;
                }
                userContextRunner.callAsUser(target.getUserCode(), () -> sandboxService.launchSandboxWithServiceKey(
                    target.getUserCode(), target.getServiceKey()));
                report.addLaunched(targetKey);
                launched++;
            }
            catch (Exception e) {
                report.addFailed(targetKey);
                LOGGER.warn("OpenClaw cron prewarm launch failed, target={}", targetKey, e);
            }
        }
        return launched;
    }
}
