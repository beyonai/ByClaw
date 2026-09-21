package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;

/** Local classification observation is independent of bounded persisted-result compensation. */
@Service
public class GroupChatStreamRouter {
    private static final Logger log = LoggerFactory.getLogger(GroupChatStreamRouter.class);
    @Autowired
    private ByaiGroupChatTurnMapper turnMapper;
    @Value("${byclaw.group-chat.scan-batch-size:100}")
    private int batchSize = 100;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatExecutionEventHandler eventHandler;
    private final Map<GroupChatExecutionStarted, Observation> observations = new ConcurrentHashMap<>();
    private final ConcurrentLinkedQueue<Observation> pending = new ConcurrentLinkedQueue<>();
    private final ExecutorService observers = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    private long turnCursor;
    private long legacyCursor;

    public GroupChatStreamRouter(ByaiGroupChatExecutionMapper executionMapper,
        GroupChatExecutionEventHandler eventHandler) {
        this.executionMapper = executionMapper;
        this.eventHandler = eventHandler;
    }

    @EventListener
    public void onExecutionStarted(GroupChatExecutionStarted event) {
        if (event.traceId() == null) return;
        Observation observation = new Observation(event);
        if (observations.putIfAbsent(event, observation) == null) pending.add(observation);
    }

    /** This high-frequency tick never discovers work by querying a database table. */
    @Scheduled(fixedDelayString = "${byclaw.group-chat.classification-observe-ms:500}")
    public void observeClassifications() {
        int count = Math.min(batchSize, pending.size());
        for (int i = 0; i < count; i++) {
            Observation observation = pending.poll();
            if (observation == null) break;
            if (observation.nextAttempt > System.currentTimeMillis()) {
                pending.add(observation);
                continue;
            }
            try {
                observers.execute(() -> observe(observation));
            }
            catch (RejectedExecutionException error) {
                pending.add(observation);
            }
        }
    }

    private void observe(Observation observation) {
        boolean keep = true;
        try {
            GroupChatExecutionStarted key = observation.key;
            keep = eventHandler.observe(key.executionId(), key.turn(), key.traceId());
            observation.failures = 0;
            observation.nextAttempt = System.currentTimeMillis() + 500;
        }
        catch (RuntimeException error) {
            observation.failures = Math.min(6, observation.failures + 1);
            observation.nextAttempt = System.currentTimeMillis() + Math.min(30000, 500L << observation.failures);
            log.warn("Group classification observation failed: executionId={}", observation.key.executionId(), error);
        }
        finally {
            // The handler returns only after its projection transaction commits; failed commits remain retryable.
            if (keep) pending.add(observation);
            else observations.remove(observation.key, observation);
        }
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.completion-recovery-ms:30000}")
    public void pollRunningExecutions() {
        if (turnMapper != null) {
            List<ByaiGroupChatTurn> turns = turnMapper.selectBoundPage(turnCursor, batchSize);
            turnCursor = turns.size() < batchSize ? 0 : turns.get(turns.size() - 1).getExecutionId();
            for (ByaiGroupChatTurn turn : turns) {
                try { eventHandler.reconcileTurn(turn.getExecutionId()); }
                catch (RuntimeException error) { log.warn("Group turn reconciliation failed: turnId={}", turn.getExecutionId(), error); }
            }
        }
        List<ByaiGroupChatExecution> executions = executionMapper.selectBoundPage(legacyCursor, batchSize);
        legacyCursor = executions.size() < batchSize ? 0 : executions.get(executions.size() - 1).getExecutionId();
        for (ByaiGroupChatExecution execution : executions) {
            try { eventHandler.reconcile(execution.getCandidateSessionId()); }
            catch (RuntimeException error) { log.warn("Group execution reconciliation failed: executionId={}", execution.getExecutionId(), error); }
        }
    }

    @PreDestroy
    public void shutdown() { observers.shutdown(); }

    private static final class Observation {
        private final GroupChatExecutionStarted key;
        private long nextAttempt;
        private int failures;
        private Observation(GroupChatExecutionStarted key) { this.key = key; }
    }
}
