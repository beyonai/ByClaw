package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ConcurrentHashMap;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.chat.model.ExternalChildSessionBinding;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 维护父会话范围内外部执行器子会话到 ByClaw 子会话的稳定映射。
 */
@Service
public class ExternalChildSessionService {

    public static final String EXT_EXTERNAL_SESSION_ID = "external_session_id";

    public static final String EXT_EXTERNAL_ROOT_SESSION_ID = "external_root_session_id";

    public static final String EXT_EXTERNAL_TEAM_ID = "external_team_id";

    public static final String EXT_CHILD_NAME = "child_name";

    public static final String EXT_CHILD_ROLE = "child_role";

    public static final String EXT_EXTERNAL_SESSION_STATUS = "external_session_status";

    public static final String EXT_EXTERNAL_MESSAGE_ID = "external_message_id";

    public static final String EXT_EVENT_SOURCE = "event_source";

    private static final String EXT_EXTERNAL_RUN_MESSAGE_PREFIX = "external_run_message_";

    private final SessionService sessionService;

    private final SessionExtService sessionExtService;

    private final SequenceService sequenceService;

    private final TransactionTemplate bindingTransaction;

    private final Map<String, ExternalChildSessionBinding> bindings = new ConcurrentHashMap<>();

    private final Map<String, ExternalChildSessionBinding> runBindings = new ConcurrentHashMap<>();

    private final Map<Long, JSONObject> latestRuns = new ConcurrentHashMap<>();

    private final Map<String, Object> bindingLocks = new ConcurrentHashMap<>();

    public ExternalChildSessionService(
            SessionService sessionService,
            SessionExtService sessionExtService,
            SequenceService sequenceService,
            PlatformTransactionManager transactionManager
    ) {
        this.sessionService = sessionService;
        this.sessionExtService = sessionExtService;
        this.sequenceService = sequenceService;
        this.bindingTransaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 查找或创建一个父会话范围内唯一的外部子会话绑定。
     *
     * @param parentSessionId ByClaw 父会话标识
     * @param metadata 通用外部会话事件元数据
     * @return 子会话绑定
     */
    public ExternalChildSessionBinding ensureBinding(Long parentSessionId, JSONObject metadata) {
        if (parentSessionId == null) {
            throw new IllegalArgumentException("parentSessionId must not be null");
        }
        String externalSessionId = metadata == null ? null
            : StringUtils.trim(metadata.getString(EXT_EXTERNAL_SESSION_ID));
        if (StringUtils.isBlank(externalSessionId)) {
            throw new IllegalArgumentException("external_session_id must not be blank");
        }

        String bindingKey = parentSessionId + ":" + externalSessionId;
        ExternalChildSessionBinding cached = bindings.get(bindingKey);
        if (cached != null) {
            return cached;
        }

        Object lock = bindingLocks.computeIfAbsent(bindingKey, key -> new Object());
        synchronized (lock) {
            cached = bindings.get(bindingKey);
            if (cached != null) {
                return cached;
            }

            // Only a cache miss needs the database. Publish the binding after commit so rolled-back
            // child creation can never become the baseline for later stream chunks.
            ExternalChildSessionBinding binding = Objects.requireNonNull(bindingTransaction.execute(status -> {
                ExternalChildSessionBinding existing = findExisting(parentSessionId, externalSessionId);
                return existing == null ? createBinding(parentSessionId, externalSessionId, metadata) : existing;
            }));
            bindings.put(bindingKey, binding);
            bindingLocks.remove(bindingKey, lock);
            return binding;
        }
    }

    /** Return a distinct durable message binding for one child execution turn. */
    public ExternalChildSessionBinding ensureRunBinding(Long parentSessionId, JSONObject metadata) {
        ExternalChildSessionBinding sessionBinding = ensureBinding(parentSessionId, metadata);
        String runId = metadata == null ? null : StringUtils.trimToNull(metadata.getString("child_run_id"));
        if (runId == null) return sessionBinding;
        String bindingKey = parentSessionId + ":" + sessionBinding.externalSessionId() + ":" + runId;
        ExternalChildSessionBinding cached = runBindings.get(bindingKey);
        if (cached != null) return cached;
        Object lock = bindingLocks.computeIfAbsent(bindingKey, key -> new Object());
        synchronized (lock) {
            cached = runBindings.get(bindingKey);
            if (cached != null) return cached;
            String extCode = EXT_EXTERNAL_RUN_MESSAGE_PREFIX + sha256(runId);
            ExternalChildSessionBinding binding = Objects.requireNonNull(bindingTransaction.execute(status -> {
                ByaiSessionExt existing = sessionExtService.findOneByExtParamCode(sessionBinding.session().getSessionId(), extCode);
                if (existing != null && StringUtils.isNumeric(existing.getExtParamValue())) {
                    return new ExternalChildSessionBinding(sessionBinding.session(), sessionBinding.externalSessionId(),
                        Long.valueOf(existing.getExtParamValue()));
                }
                Long messageId = sequenceService.nextVal();
                ByaiSessionExt runMessage = new ByaiSessionExt();
                runMessage.setExtId(sequenceService.nextVal());
                runMessage.setSessionId(sessionBinding.session().getSessionId());
                runMessage.setExtParamCode(extCode);
                runMessage.setExtParamName("外部子会话运行消息标识");
                runMessage.setExtParamValue(String.valueOf(messageId));
                sessionExtService.save(runMessage);
                return new ExternalChildSessionBinding(sessionBinding.session(), sessionBinding.externalSessionId(), messageId);
            }));
            runBindings.put(bindingKey, binding);
            bindingLocks.remove(bindingKey, lock);
            return binding;
        }
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format("%02x", item));
            return result.toString();
        }
        catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /** Event-only watermark; resolving a historical task link must never advance this marker. */
    public boolean isStaleRun(ExternalChildSessionBinding binding, JSONObject metadata) {
        Long turn = metadata.getLong("child_turn");
        String runId = StringUtils.trimToNull(metadata.getString("child_run_id"));
        if (turn == null || runId == null) return false;
        Long sessionId = binding.session().getSessionId();
        JSONObject cached = latestRuns.get(sessionId);
        if (cached != null && turn <= cached.getLong("turn")) {
            return turn < cached.getLong("turn") || !runId.equals(cached.getString("runId"));
        }
        JSONObject marker = new JSONObject();
        marker.put("turn", turn);
        marker.put("runId", runId);
        boolean stale = Boolean.TRUE.equals(bindingTransaction.execute(status -> {
            String code = "external_latest_run";
            ByaiSessionExt existing = sessionExtService.findOneByExtParamCode(sessionId, code);
            JSONObject previous = existing == null ? null : JSONObject.parseObject(existing.getExtParamValue());
            Long previousTurn = previous == null ? null : previous.getLong("turn");
            if (previousTurn != null) {
                if (turn < previousTurn || turn.equals(previousTurn) && !runId.equals(previous.getString("runId"))) return true;
                if (turn.equals(previousTurn)) return false;
            }
            if (existing == null) {
                ByaiSessionExt extension = new ByaiSessionExt();
                extension.setExtId(sequenceService.nextVal());
                extension.setSessionId(sessionId);
                extension.setExtParamCode(code);
                extension.setExtParamName("外部子会话当前运行轮次");
                extension.setExtParamValue(marker.toJSONString());
                sessionExtService.save(extension);
            }
            else {
                existing.setExtParamValue(marker.toJSONString());
                sessionExtService.update(existing);
            }
            return false;
        }));
        if (!stale) latestRuns.put(sessionId, marker);
        return stale;
    }

    private ExternalChildSessionBinding findExisting(Long parentSessionId, String externalSessionId) {
        List<ByaiSessionExt> candidates = sessionExtService
            .selectListByParamCodeAndValue(EXT_EXTERNAL_SESSION_ID, externalSessionId);
        if (candidates == null) {
            return null;
        }
        for (ByaiSessionExt candidate : candidates) {
            ByaiSession child = sessionService.findById(candidate.getSessionId());
            if (child == null || !parentSessionId.equals(child.getParentSessionId())) {
                continue;
            }
            ByaiSessionExt messageExt = sessionExtService
                .findOneByExtParamCode(child.getSessionId(), EXT_EXTERNAL_MESSAGE_ID);
            if (messageExt == null || StringUtils.isBlank(messageExt.getExtParamValue())) {
                continue;
            }
            try {
                return new ExternalChildSessionBinding(child, externalSessionId,
                    Long.valueOf(messageExt.getExtParamValue()));
            }
            catch (NumberFormatException ignored) {
                // 损坏的历史映射不能作为可用绑定，继续寻找同父会话下的其他候选项。
            }
        }
        return null;
    }

    private ExternalChildSessionBinding createBinding(
            Long parentSessionId,
            String externalSessionId,
            JSONObject metadata
    ) {
        ByaiSession parent = sessionService.findById(parentSessionId);
        if (parent == null) {
            throw new MissingParentSessionException(parentSessionId);
        }

        Long childSessionId = sequenceService.nextVal();
        Long messageId = sequenceService.nextVal();
        Date now = new Date();

        ByaiSession child = new ByaiSession();
        child.setSessionId(childSessionId);
        child.setParentSessionId(parentSessionId);
        child.setSessionName(StringUtils.defaultIfBlank(metadata.getString("child_name"), "子 Agent"));
        child.setSessionContent(metadata.getString("child_task"));
        child.setCreatorId(parent.getCreatorId());
        child.setEnterpriseId(parent.getEnterpriseId());
        child.setProjectId(parent.getProjectId());
        child.setObjectId(parent.getObjectId());
        child.setObjectType(parent.getObjectType());
        child.setSessionType(parent.getSessionType());
        child.setIsDebug(parent.getIsDebug());
        child.setCreateTime(now);
        child.setUpdateTime(now);
        sessionService.save(child);

        saveExt(childSessionId, EXT_EXTERNAL_SESSION_ID, "外部会话标识", externalSessionId);
        saveExt(childSessionId, EXT_EXTERNAL_ROOT_SESSION_ID, "外部根会话标识",
            metadata.getString("external_root_session_id"));
        saveExt(childSessionId, EXT_EXTERNAL_TEAM_ID, "外部团队标识", metadata.getString("team_id"));
        saveExt(childSessionId, EXT_CHILD_NAME, "子会话名称", metadata.getString("child_name"));
        saveExt(childSessionId, EXT_CHILD_ROLE, "子会话角色", metadata.getString("child_role"));
        saveExt(childSessionId, EXT_EXTERNAL_SESSION_STATUS, "外部会话状态",
            metadata.getString("session_status"));
        saveExt(childSessionId, EXT_EXTERNAL_MESSAGE_ID, "外部消息标识", String.valueOf(messageId));
        saveExt(childSessionId, EXT_EVENT_SOURCE, "事件来源", metadata.getString("event_source"));

        return new ExternalChildSessionBinding(child, externalSessionId, messageId);
    }

    /** 与元数据无效、数据库故障等可重试错误区分，供 Stream 路由处理历史孤儿事件。 */
    public static class MissingParentSessionException extends IllegalArgumentException {
        public MissingParentSessionException(Long parentSessionId) {
            super("parent session does not exist: " + parentSessionId);
        }
    }

    private void saveExt(Long sessionId, String code, String name, String value) {
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtId(sequenceService.nextVal());
        ext.setSessionId(sessionId);
        ext.setExtParamCode(code);
        ext.setExtParamName(name);
        ext.setExtParamValue(StringUtils.defaultString(value));
        sessionExtService.save(ext);
    }
}
