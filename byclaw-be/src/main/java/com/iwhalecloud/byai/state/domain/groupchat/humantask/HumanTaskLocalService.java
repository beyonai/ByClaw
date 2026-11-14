package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.groupchat.HumanTaskListView;
import com.iwhalecloud.byai.common.constants.groupchat.HumanTaskStatus;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCoordinationService;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskRules.*;
/** Public-database lifecycle. All mutations execute in one transaction and fence task changes with revisions. */
@Service
public class HumanTaskLocalService {
    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy

    private GroupChatApplicationService groupApplication;

    private final GroupHumanTaskMapper db;

    private final SequenceService ids;

    private final GroupChatAuthorizationService authorization;

    private final SessionMemberService members;

    private final SessionService sessions;

    private final ByaiMessageMapper messages;

    private final GroupChatTopicService topics;

    private final SessionExtService extensions;

    private final ByaiGroupChatTaskMapper executionTasks;

    private final SsResourceService resources;

    public HumanTaskLocalService(GroupHumanTaskMapper db, SequenceService ids, GroupChatAuthorizationService authorization,
    SessionMemberService members, SessionService sessions, ByaiMessageMapper messages, GroupChatTopicService topics,
    SessionExtService extensions, ByaiGroupChatTaskMapper executionTasks, SsResourceService resources) {
        this.db = db;
        this.ids = ids;
        this.authorization = authorization;
        this.members = members;
        this.sessions = sessions;
        this.messages = messages;
        this.topics = topics;
        this.extensions = extensions;
        this.executionTasks = executionTasks;
        this.resources = resources;
    }
    @Transactional

    public JSONObject call(Long tenant, Long actor, String action, JSONObject body) {
        return switch (action) {
            case "createProposal" -> create(tenant, actor, body, false);
            case "createDirect" -> create(tenant, actor, body, true);
            case "proposal" -> batch(tenant, id(body, "batchId"), false);
            case "batch" -> batch(tenant, id(body, "batchId"), true);
            case "updateProposal" -> update(tenant, actor, body);
            case "confirm" -> confirm(tenant, actor, body);
            case "task" -> task(tenant, id(body, "humanTaskId"));
            case "list" -> list(tenant, actor, body);
            case "groupList" -> groupList(tenant, actor, body);
            case "counts" -> counts(tenant, actor, body);
            case "history" -> history(tenant, id(body, "humanTaskId"));
            case "binding" -> binding(tenant, id(body, "taskSessionId"));
            case "bind" -> bind(tenant, actor, body);
            case "submit" -> submit(tenant, actor, body);
            case "review" -> review(tenant, actor, body);
            case "request" -> request(tenant, id(body, "humanTaskId"), requestId(body));
            case "checkpoint" -> checkpoint(tenant, id(body, "humanTaskId"), requestId(body), body.getString("payloadHash"), body.getJSONObject("payload"));
            default -> throw new IllegalArgumentException("HUMAN_TASK_INVALID_ACTION");
        };
    }

    private JSONObject create(Long tenant, Long actor, JSONObject b, boolean direct) {
        String request = requestId(b);
        JSONObject canonical = creationSource(actor, b, direct);
        Long group = canonical.getLong("groupSessionId");
        canonical.put("requestId", request);
        canonical.put("creationMode", direct ? "DIRECT" : "PROPOSAL");
        canonical.put("items", items(b, false, group));
        String digest = creationHash(canonical);
        JSONObject existing = parseBatch(db.proposalRequest(tenant, actor, request));
        if (existing != null) {
            require(digest.equals(existing.getString("payloadHash"))
                || matchesLegacyProposal(b, canonical, existing, direct), "IDEMPOTENCY_MISMATCH");
            return batch(tenant, existing.getLong("batchId"), true);
        }
        authorization.requireUserMember(group, actor);
        requireGroupScope(tenant, group);
        Long sourceSession = canonical.getLong("sourceTaskSessionId");
        if (sourceSession != null) {
            var executionSession = sessions.findById(sourceSession);
            // Personal groups may retain their cloud project's physical enterprise; compare the persisted scopes.
            require(executionSession != null && Objects.equals(executionSession.getEnterpriseId(),
                sessions.findById(group).getEnterpriseId()), "SOURCE_MISMATCH");
        }
        Long source = canonical.getLong("sourceMessageId");
        if (source != null) {
            ByaiMessage message = messages.selectByMessageId(source);
            require(message != null && group.equals(message.getSessionId()) && actor.equals(message.getCreatorId()), "SOURCE_MISMATCH");
        }
        JSONArray validated = direct ? items(canonical, true, group) : canonical.getJSONArray("items");
        JSONObject batch = JSON.parseObject(canonical.toJSONString());
        batch.put("batchId", next());
        batch.put("initiatorUserId", actor.toString());
        batch.put("payloadHash", digest);
        batch.put("senderName", senderName(group, batch.getString("senderType"), batch.getLong("senderId")));
        batch.put("status", direct ? "CONFIRMED" : "DRAFT");
        batch.put("revision", direct ? 1L : 0L);
        batch.put("createdAt", Instant.now().toString());
        if (direct) {
            batch.put("cardMessageId", next());
            batch.put("confirmedAt", Instant.now().toString());
        } else {
            // A proposal remains recoverable from the timeline until the initiator confirms its complete form.
            batch.put("proposalMessageId", next());
        }
        Map<String, Object> row = batchRow(tenant, batch);
        row.put("request", request);
        row.put("hash", digest);
        db.insertBatch(row);
        if (direct) {
            createTasks(tenant, batch, validated);
            message(batch, "HUMAN_TASK_BATCH", batch.getLong("cardMessageId"));
            JSONObject result = batch(tenant, batch.getLong("batchId"), true);
            result.put("_createdMessageId", batch.getString("cardMessageId"));
            return result;
        }
        message(batch, "HUMAN_TASK_PROPOSAL", batch.getLong("proposalMessageId"));
        batch.put("_createdMessageId", batch.getString("proposalMessageId"));
        return batch;
    }

    /** An upgraded proposal accepts only its exact previous Java request shape, never a direct-create replay. */
    private boolean matchesLegacyProposal(JSONObject body, JSONObject canonical, JSONObject existing, boolean direct) {
        if (direct || existing.containsKey("creationMode")) return false;
        JSONObject legacy = JSON.parseObject(body.toJSONString());
        if (legacy.containsKey("sourceTaskSessionId")) {
            // The previous facade resolved source fields before deleting the execution-session parameter.
            legacy.put("groupSessionId", canonical.getString("groupSessionId"));
            legacy.put("sourceMessageId", canonical.getString("sourceMessageId"));
            legacy.remove("sourceTaskSessionId");
        }
        return hash(legacy).equals(existing.getString("payloadHash"));
    }

    /** External sender and initiator fields never enter the identity or idempotency snapshot. */
    private JSONObject creationSource(Long actor, JSONObject body, boolean direct) {
        JSONObject source = new JSONObject();
        Long session = direct || body.get("sourceTaskSessionId") == null ? null : id(body, "sourceTaskSessionId");
        Long group;
        Long sourceMessage;
        Long sender = actor;
        if (session == null) {
            group = id(body, "groupSessionId");
            sourceMessage = direct || body.get("sourceMessageId") == null ? null : id(body, "sourceMessageId");
        } else {
            List<Map<String, Object>> candidates = db.creationSources(session);
            require(candidates != null && !candidates.isEmpty(), "SOURCE_MISMATCH");
            Map<String, Object> identity = candidates.get(0);
            require(candidates.stream().allMatch(identity::equals), "SOURCE_AMBIGUOUS");
            require(actor.toString().equals(Objects.toString(identity.get("initiatorUserId"), null)), "SOURCE_MISMATCH");
            JSONObject persisted = new JSONObject(identity);
            group = id(persisted, "groupSessionId");
            sender = id(persisted, "targetAgentId");
            sourceMessage = persisted.get("sourceMessageId") == null ? null : id(persisted, "sourceMessageId");
            require(body.get("groupSessionId") == null || group.equals(id(body, "groupSessionId")), "SOURCE_MISMATCH");
            require(body.get("sourceMessageId") == null || Objects.equals(sourceMessage, id(body, "sourceMessageId")), "SOURCE_MISMATCH");
        }
        source.put("groupSessionId", group.toString());
        source.put("sourceMessageId", sourceMessage == null ? null : sourceMessage.toString());
        source.put("sourceTaskSessionId", session == null ? null : session.toString());
        source.put("senderType", session == null ? "USER" : "AGENT");
        source.put("senderId", sender.toString());
        return source;
    }

    private JSONObject update(Long tenant, Long actor, JSONObject b) {
        JSONObject batch = batch(tenant, id(b, "batchId"), false);
        require(actor.toString().equals(batch.getString("initiatorUserId")), "INITIATOR_REQUIRED");
        require("DRAFT".equals(batch.getString("status")), "PROPOSAL_CONFIRMED");
        long rev = batch.getLongValue("revision");
        require(b.containsKey("expectedRevision") && b.getLongValue("expectedRevision") == rev, "STALE_PROPOSAL");
        batch.put("items", items(b, false, batch.getLong("groupSessionId")));
        batch.put("revision", rev+1);
        var row = batchRow(tenant, batch);
        row.put("expected", rev);
        require(db.updateBatch(row) == 1, "STALE_PROPOSAL");
        return batch;
    }

    private JSONObject confirm(Long tenant, Long actor, JSONObject b) {
        JSONObject batch = batch(tenant, id(b, "batchId"), false);
        require(actor.toString().equals(batch.getString("initiatorUserId")), "INITIATOR_REQUIRED");
        if ("CONFIRMED".equals(batch.getString("status"))) return batch(tenant, batch.getLong("batchId"), true);
        long rev = batch.getLongValue("revision");
        require(b.containsKey("expectedRevision") && b.getLongValue("expectedRevision") == rev, "STALE_PROPOSAL");
        Long group = batch.getLong("groupSessionId");
        authorization.requireUserMember(group, actor);
        JSONArray validated = items(batch, true, group);
        batch.put("status", "CONFIRMED");
        batch.put("revision", rev+1);
        batch.put("cardMessageId", next());
        batch.put("confirmedAt", Instant.now().toString());
        var row = batchRow(tenant, batch);
        row.put("expected", rev);
        require(db.updateBatch(row) == 1, "STALE_PROPOSAL");
        createTasks(tenant, batch, validated);
        message(batch, "HUMAN_TASK_BATCH", batch.getLong("cardMessageId"));
        JSONObject result = batch(tenant, batch.getLong("batchId"), true);
        result.put("_createdMessageId", batch.getString("cardMessageId"));
        return result;
    }

    /** Both entry points persist the same task lifecycle inside the caller's batch transaction. */
    private void createTasks(Long tenant, JSONObject batch, JSONArray validated) {
        for (int index = 0; index<validated.size(); index++) {
            JSONObject task = JSON.parseObject(validated.getJSONObject(index).toJSONString());
            task.put("humanTaskId", next());
            task.put("batchId", batch.getString("batchId"));
            task.put("groupSessionId", batch.getString("groupSessionId"));
            task.put("initiatorUserId", batch.getString("initiatorUserId"));
            task.put("status", "PENDING");
            task.put("revision", 0L);
            task.put("latestVersion", 0);
            task.put("position", index);
            task.put("createdAt", Instant.now().toString());
            db.insertTask(taskRow(tenant, task));
        }
    }

    private JSONArray items(JSONObject b, boolean complete, Long group) {
        JSONArray input = b.getJSONArray("items");
        require(input != null && !input.isEmpty() && input.size() <= 100, "INVALID_ITEMS");
        JSONArray clean = new JSONArray();
        Set<String> keys = new HashSet<>();
        for (int i = 0; i<input.size(); i++) {
            JSONObject raw = input.getJSONObject(i);
            require(raw != null, "INVALID_ITEM");
            JSONObject item = new JSONObject();
            String key = raw.getString("itemKey");
            if (key == null)key = Integer.toString(i+1);
            require(key.length() <= 128 && keys.add(key), "INVALID_ITEM_KEY");
            item.put("itemKey", key);
            for (String field:List.of("title", "content", "acceptanceCriteria")) {
                String value = raw.getString(field);
                item.put(field, value == null?"":value.trim());
            }
            require(item.getString("title").length() <= 512 && item.getString("content").length() <= 100000 && item.getString("acceptanceCriteria").length() <= 100000, "ITEM_TOO_LARGE");
            String owner = raw.getString("assigneeUserId");
            if (owner != null && !owner.isBlank())item.put("assigneeUserId", id(raw, "assigneeUserId").toString());
            String deadline = raw.getString("deadline");
            if (deadline != null && !deadline.isBlank()) {
                try {
                    item.put("deadline", new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
                        .format(java.time.OffsetDateTime.parse(deadline).toInstant()));
                }
                catch (Exception e) {
                    require(false, "INVALID_DEADLINE");
                }
            }
            if (complete) {
                require(!item.getString("title").isBlank() && !item.getString("content").isBlank() && item.getString("assigneeUserId") != null, "ITEM_INCOMPLETE");
                require(members.findSessionMember(group, "USER", item.getLong("assigneeUserId")) != null, "ASSIGNEE_NOT_GROUP_MEMBER");
            }
            clean.add(item);
        }
        return clean;
    }

    private JSONObject batch(Long tenant, Long id, boolean withTasks) {
        JSONObject batch = parseBatch(db.batch(tenant, id));
        require(batch != null, "NOT_FOUND");
        if (withTasks && "CONFIRMED".equals(batch.getString("status")))batch.put("items", db.batchTasks(tenant, id).stream().map(JSON::parseObject).toList());
        return batch;
    }

    private JSONObject task(Long tenant, Long id) {
        JSONObject t = parse(db.task(tenant, id));
        require(t != null, "NOT_FOUND");
        return t;
    }

    /** Counts actionable tasks once; returned tasks are already included in pendingCompletion. */
    private JSONObject counts(Long tenant, Long actor, JSONObject body) {
        Long groupSessionId = body.get("groupSessionId") == null ? null : id(body, "groupSessionId");
        JSONObject result = new JSONObject(db.counts(tenant, actor, groupSessionId));
        result.put("total", result.getLongValue("pendingReview") + result.getLongValue("pendingCompletion"));
        return result;
    }

    private JSONObject list(Long tenant, Long actor, JSONObject b) {
        String view = b.getString("view");
        // A supplied business view is authoritative; empty and unknown values cannot widen the query.
        require(view == null || HumanTaskListView.PENDING_REVIEW.equals(view)
            || HumanTaskListView.PENDING_COMPLETION.equals(view)
            || HumanTaskListView.PENDING_MODIFICATION.equals(view), "INVALID_VIEW");
        int size = b.getIntValue("pageSize");
        if (size == 0)size = 20;
        require(size>0 && size <= 100, "INVALID_PAGE_SIZE");
        int page = b.getIntValue("pageNum");
        if (page == 0)page = 1;
        require(page>0 && page <= 1000000, "INVALID_PAGE");
        Map<String, Object> q = new HashMap<>();
        q.put("tenant", tenant);
        q.put("actor", actor);
        q.put("view", view);
        q.put("groupSessionId", b.get("groupSessionId") == null ? null : id(b, "groupSessionId"));
        q.put("relation", b.getString("relation"));
        q.put("status", b.getString("status"));
        q.put("limit", size);
        q.put("offset", (page-1)*size);
        JSONObject result = new JSONObject();
        result.put("items", db.list(q).stream().map(JSON::parseObject).toList());
        result.put("total", db.count(q));
        return result;
    }

    /** Group membership grants visibility to all group tasks, including historical assignments. */
    private JSONObject groupList(Long tenant, Long actor, JSONObject body) {
        Long groupSessionId = id(body, "groupSessionId");
        requireGroupScope(tenant, groupSessionId);
        authorization.requireUserMember(groupSessionId, actor);
        String status = body.getString("status");
        require(status == null || Set.of(HumanTaskStatus.PENDING, HumanTaskStatus.PENDING_REVIEW,
            HumanTaskStatus.CHANGES_REQUESTED, HumanTaskStatus.ACCEPTED).contains(status), "INVALID_STATUS");
        int page = body.get("pageNum") == null ? 1 : body.getIntValue("pageNum");
        int size = body.get("pageSize") == null ? 20 : body.getIntValue("pageSize");
        require(page >= 1 && page <= 1000000, "INVALID_PAGE");
        require(size >= 1 && size <= 100, "INVALID_PAGE_SIZE");
        Map<String, Object> query = new HashMap<>();
        query.put("tenant", tenant);
        query.put("groupSessionId", groupSessionId);
        query.put("status", status);
        query.put("initiatorUserIds", groupListUserIds(body, "initiatorUserIds"));
        query.put("assigneeUserIds", groupListUserIds(body, "assigneeUserIds"));
        query.put("limit", size);
        query.put("offset", (page - 1) * size);
        JSONObject result = new JSONObject();
        result.put("items", db.listGroup(query).stream().map(JSON::parseObject).toList());
        result.put("total", db.countGroup(query));
        return result;
    }

    /** Validates bounded positive IDs without requiring selected historical users to remain members. */
    private List<Long> groupListUserIds(JSONObject body, String field) {
        Object raw = body.get(field);
        if (raw == null) {
            return List.of();
        }
        String error = "INVALID_" + field;
        require(raw instanceof List<?>, error);
        Set<Long> selected = new LinkedHashSet<>();
        for (Object value : (List<?>) raw) {
            require(value instanceof String, error);
            String userId = (String) value;
            require(userId.matches("[1-9][0-9]{0,18}"), error);
            require(userId.length() < 19 || userId.compareTo(Long.toString(Long.MAX_VALUE)) <= 0, error);
            selected.add(Long.valueOf(userId));
            require(selected.size() <= 100, error);
        }
        return List.copyOf(selected);
    }

    private JSONObject binding(Long tenant, Long session) {
        Map<String, Object> row = db.binding(tenant, session);
        if (row == null)return null;
        JSONObject b = new JSONObject();
        b.put("humanTaskId", row.get("humanTaskId").toString());
        b.put("taskSessionId", session.toString());
        b.put("entryType", row.get("entryType"));
        b.put("groupSessionId", task(tenant, b.getLong("humanTaskId")).getString("groupSessionId"));
        var execution = executionTasks.selectById(session);
        if (execution != null && execution.getTargetAgentId() != null) {
            b.put("targetAgentId", execution.getTargetAgentId().toString());
        }
        // Read only this bound root's persisted scope; child sessions are not human-task submission roots.
        var scope = extensions.findOneByExtParamCode(session, GroupChatCoordinationService.SCOPE_EXT);
        if (scope != null) b.put("groupCoordination", JSON.parseObject(scope.getExtParamValue()));
        return b;
    }

    private JSONObject bind(Long tenant, Long actor, JSONObject body) {
        JSONObject task = task(tenant, id(body, "humanTaskId"));
        body = new JSONObject(new LinkedHashMap<>(body));
        Map<String, Object> reservation = null;
        if (!body.containsKey("taskSessionId")) {
            require("PRIVATE".equals(body.getString("entryType")), "INVALID_ENTRY_TYPE");
            String legacyDigest = hash(body);
            List<Long> selected = normalizePrivateAgents(body);
            String key = "bind:"+requestId(body), digest = hash(body);
            require(key.length() <= 128, "REQUEST_ID_TOO_LONG");
            reservation = new HashMap<>();
            reservation.put("id", task.getLong("humanTaskId"));
            reservation.put("request", key);
            reservation.put("hash", digest);
            JSONObject progress = new JSONObject();
            progress.put("status", "CREATING");
            progress.put("payloadHash", digest);
            reservation.put("payload", progress.toJSONString());
            db.insertRequest(reservation);
            JSONObject previous = parse(db.request(task.getLong("humanTaskId"), key));
            require(digest.equals(previous.getString("payloadHash")) || legacyDigest.equals(previous.getString("payloadHash")), "IDEMPOTENCY_MISMATCH");
            if ("SESSION_CREATED".equals(previous.getString("status"))) {
                JSONObject priorResult = previous.getJSONObject("result");
                var priorSession = sessions.findById(priorResult.getLong("taskSessionId"));
                require(priorSession != null && actor.equals(priorSession.getCreatorId()), "SESSION_SCOPE_MISMATCH");
                return binding(tenant, priorResult.getLong("taskSessionId"));
            }
            writable(task);
            for (Long agentId : selected) {
                require(members.findSessionMember(task.getLong("groupSessionId"), "AGENT", agentId) != null, "AGENT_NOT_GROUP_MEMBER");
            }
            var created = groupApplication.createHumanTaskPrivateSession(task.getLong("groupSessionId"), selected);
            body.put("taskSessionId", created.getTaskSessionId().toString());
        }
        writable(task);
        Long session = id(body, "taskSessionId");
        String type = body.getString("entryType");
        if ("PRIVATE".equals(type))require(db.ordinaryPrivateBinding(session)==0, "ORDINARY_PRIVATE_SESSION");
        require("PRIVATE".equals(type) || "GROUP".equals(type), "INVALID_ENTRY_TYPE");
        var execution = sessions.findById(session);
        var executionTask = executionTasks.selectById(session);
        require(execution != null && actor.equals(execution.getCreatorId()) && executionTask != null && task.getLong("groupSessionId").equals(executionTask.getGroupSessionId()), "SESSION_SCOPE_MISMATCH");
        require("PRIVATE".equals(type)?"PRIVATE".equals(executionTask.getStatus()):"ACTIVE".equals(executionTask.getStatus()), "INVALID_SESSION_STATE");
        requireGroupScope(tenant, task.getLong("groupSessionId"));
        require(execution.getObjectId() != null && members.findSessionMember(task.getLong("groupSessionId"), "AGENT", execution.getObjectId()) != null, "AGENT_NOT_GROUP_MEMBER");
        JSONObject existing = binding(tenant, session);
        if (existing != null) {
            require(existing.getString("humanTaskId").equals(task.getString("humanTaskId")), "SESSION_ALREADY_BOUND");
            return existing;
        }
        // The conditional write fences acceptance without changing the visible revision; new session creation rolls back with it.
        require(db.requireOpenForBinding(tenant, task.getLong("humanTaskId"))==1, "ACCEPTED");
        db.bind(Map.of("session", session, "tenant", tenant, "task", task.getLong("humanTaskId"), "type", type));
        existing = binding(tenant, session);
        require(existing != null && existing.getString("humanTaskId").equals(task.getString("humanTaskId")), "SESSION_ALREADY_BOUND");
        if (reservation != null) {
            JSONObject receipt = new JSONObject();
            receipt.put("status", "SESSION_CREATED");
            receipt.put("payloadHash", reservation.get("hash"));
            receipt.put("result", existing);
            reservation.put("payload", receipt.toJSONString());
            db.updateRequest(reservation);
        }
        return existing;
    }

    /** Normalize equivalent selections before hashing so ordering, duplicates and JSON number/string IDs replay alike. */
    private List<Long> normalizePrivateAgents(JSONObject body) {
        boolean single = body.get("agentId") != null;
        boolean multiple = body.get("agentIds") != null;
        require(single != multiple, "INVALID_AGENT_IDS");
        Object raw = multiple ? body.get("agentIds") : List.of(body.get("agentId"));
        require(raw instanceof List<?>, "INVALID_AGENT_IDS");
        TreeSet<Long> selected = new TreeSet<>();
        for (Object value : (List<?>) raw) {
            require(value instanceof String || value instanceof Number, "INVALID_AGENT_IDS");
            JSONObject candidate = new JSONObject();
            candidate.put("agentId", value.toString().trim());
            selected.add(id(candidate, "agentId"));
        }
        require(!selected.isEmpty() && selected.size() <= 100, "INVALID_AGENT_IDS");
        List<Long> result = List.copyOf(selected);
        body.remove("agentId");
        body.remove("agentIds");
        if (result.size() == 1) body.put("agentId", result.getFirst().toString());
        else body.put("agentIds", result.stream().map(Object::toString).toList());
        return result;
    }

    private JSONObject request(Long tenant, Long id, String request) {
        task(tenant, id);
        return parse(db.request(id, request));
    }

    private JSONObject checkpoint(Long tenant, Long id, String request, String digest, JSONObject progress) {
        task(tenant, id);
        require(digest != null && digest.matches("[0-9a-f]{64}"), "INVALID_PAYLOAD_HASH");
        JSONObject value = new JSONObject();
        value.put("status", "UPLOADING");
        value.put("payloadHash", digest);
        value.put("payload", progress == null?new JSONObject():progress);
        var row = new HashMap<String, Object>();
        row.put("id", id);
        row.put("request", request);
        row.put("hash", digest);
        row.put("payload", value.toJSONString());
        db.insertRequest(row);
        Map<String, Object> snapshot = db.requestState(id, request);
        JSONObject existing = parse(snapshot.get("payload").toString());
        require(digest.equals(existing.getString("payloadHash")), "IDEMPOTENCY_MISMATCH");
        if ("SUCCEEDED".equals(existing.getString("status")))return existing;
        row.put("expected", snapshot.get("revision"));
        if (db.checkpointRequest(row) != 1) {
            JSONObject current = parse(db.request(id, request));
            if ("SUCCEEDED".equals(current.getString("status")))return current;
            require(false, "UPLOAD_CHECKPOINT_CHANGED");
        }
        return value;
    }

    private JSONObject submit(Long tenant, Long actor, JSONObject b) {
        Long id = id(b, "humanTaskId");
        String request = requestId(b);
        String digest = b.getString("payloadHash");
        if (digest == null)digest = hash(b);
        JSONObject old = request(tenant, id, request);
        if (old != null) {
            require(digest.equals(old.getString("payloadHash")), "IDEMPOTENCY_MISMATCH");
            if ("SUCCEEDED".equals(old.getString("status")))return old.getJSONObject("result");
        }
        JSONObject task = task(tenant, id);
        writable(task);
        content(b);
        Long session = null, pending = null;
        if (!"DIRECT".equals(b.getString("sourceType"))) {
            session = id(b, "taskSessionId");
            pending = id(b, "pendingPublicationId");
            JSONObject link = binding(tenant, session);
            require(link != null && id.toString().equals(link.getString("humanTaskId")), "SESSION_NOT_BOUND");
        }
        long revision = task.getLongValue("revision");
        int version = task.getIntValue("latestVersion")+1;
        JSONObject result = new JSONObject();
        result.put("submissionId", next());
        result.put("humanTaskId", id.toString());
        result.put("version", version);
        result.put("status", "PENDING_REVIEW");
        result.put("text", Objects.toString(b.getString("text"), "").trim());
        result.put("files", b.getJSONArray("files") == null?new JSONArray():b.getJSONArray("files"));
        result.put("sourceType", b.getString("sourceType"));
        result.put("taskSessionId", session == null?null:session.toString());
        result.put("submitterUserId", actor.toString());
        result.put("createdAt", Instant.now().toString());
        task.put("latestVersion", version);
        task.put("latestSubmissionId", result.getString("submissionId"));
        task.put("status", "PENDING_REVIEW");
        task.put("revision", revision+1);
        var row = taskRow(tenant, task);
        row.put("expected", revision);
        require(db.updateTask(row) == 1, "STATE_CHANGED");
        if (session != null)require(db.consumePending(session, pending) == 1, "STALE_PUBLICATION");
        row.put("request", request);
        row.put("hash", digest);
        row.put("payload", result.toJSONString());
        db.insertSubmission(row);
        JSONObject recorded = new JSONObject();
        recorded.put("status", "SUCCEEDED");
        recorded.put("payloadHash", digest);
        recorded.put("payload", old == null?new JSONObject():old.getJSONObject("payload"));
        recorded.put("result", result);
        row.put("payload", recorded.toJSONString());
        db.insertRequest(row);
        require(db.updateRequest(row) == 1, "IDEMPOTENCY_MISMATCH");
        return result;
    }

    private JSONObject review(Long tenant, Long actor, JSONObject b) {
        Long id = id(b, "humanTaskId");
        String request = requestId(b), digest = hash(b);
        JSONObject old = parse(db.reviewRequest(tenant, id, request));
        if (old != null) {
            require(digest.equals(old.getString("payloadHash")), "IDEMPOTENCY_MISMATCH");
            return old;
        }
        JSONObject task = task(tenant, id);
        HumanTaskRules.review(task, b);
        long revision = task.getLongValue("revision");
        task.put("status", "ACCEPT".equals(b.getString("decision"))?"ACCEPTED":"CHANGES_REQUESTED");
        task.put("revision", revision+1);
        var row = taskRow(tenant, task);
        row.put("expected", revision);
        require(db.updateTask(row) == 1, "STALE_VERSION");
        JSONObject result = new JSONObject();
        result.put("reviewId", next());
        result.put("humanTaskId", id.toString());
        result.put("submissionId", b.getString("submissionId"));
        result.put("decision", b.getString("decision"));
        result.put("opinion", Objects.toString(b.getString("opinion"), "").trim());
        result.put("reviewerUserId", actor.toString());
        result.put("createdAt", Instant.now().toString());
        result.put("status", task.getString("status"));
        result.put("revision", task.getLong("revision"));
        result.put("payloadHash", digest);
        row.put("review", result.getLong("reviewId"));
        row.put("request", request);
        row.put("hash", digest);
        row.put("payload", result.toJSONString());
        db.insertReview(row);
        return result;
    }

    private JSONObject history(Long tenant, Long id) {
        JSONObject task = task(tenant, id);
        List<JSONObject> reviews = db.reviews(tenant, id).stream().map(JSON::parseObject).toList();
        List<JSONObject> items = db.submissions(tenant, id).stream().map(JSON::parseObject).toList();
        for (JSONObject item:items) {
            item.put("superseded", !item.getString("submissionId").equals(task.getString("latestSubmissionId")));
            item.put("reviews", reviews.stream().filter(r->r.getString("submissionId").equals(item.getString("submissionId"))).toList());
        }
        JSONObject result = new JSONObject();
        result.put("items", items);
        return result;
    }

    private void message(JSONObject batch, String kind, Long messageId) {
        ByaiMessage message = new ByaiMessage();
        message.setId(messageId);
        message.setMessageId(messageId);
        message.setSessionId(batch.getLong("groupSessionId"));
        boolean agent = "AGENT".equals(batch.getString("senderType"));
        Long sender = batch.getLong("senderId");
        message.setCreatorId(sender);
        message.setCreatorName(batch.containsKey("senderName") ? batch.getString("senderName")
            : senderName(batch.getLong("groupSessionId"), batch.getString("senderType"), sender));
        message.setMessageContent("HUMAN_TASK_PROPOSAL".equals(kind)?"待办任务提案":"待办任务");
        message.setUsage(agent ? 2 : 1);
        message.setRole(agent ? "assistant" : "user");
        if (agent) message.setResComId(sender);
        message.setIsComplete(true);
        message.setCreateTime(new Date());
        message.setUpdateTime(new Date());
        JSONObject metadata = new JSONObject();
        metadata.put("scene", "GROUP_CHAT");
        metadata.put("kind", kind);
        metadata.put("batchId", batch.getString("batchId"));
        if (agent) metadata.put("targetAgentId", sender.toString());
        message.setMetadata(metadata.toJSONString());
        message.setProjectId(sessions.findById(batch.getLong("groupSessionId")).getProjectId());
        topics.persistMessage(message);
    }

    private String senderName(Long group, String type, Long sender) {
        if ("AGENT".equals(type)) {
            // Resource names are current; the membership row may have no name or retain a pre-rename value.
            var resource = resources.findById(sender);
            if (resource != null && resource.getResourceName() != null && !resource.getResourceName().isBlank()) {
                return resource.getResourceName();
            }
        }
        var member = members.findSessionMember(group, type, sender);
        if (member != null && member.getMemName() != null && !member.getMemName().isBlank()) return member.getMemName();
        return "USER".equals(type) && Objects.equals(sender, CurrentUserHolder.getCurrentUserId())
            ? CurrentUserHolder.getCurrentUserName() : null;
    }

    private Map<String, Object> batchRow(Long tenant, JSONObject b) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", b.getLong("batchId"));
        r.put("tenant", tenant);
        r.put("group", b.getLong("groupSessionId"));
        r.put("actor", b.getLong("initiatorUserId"));
        r.put("senderType", b.getString("senderType"));
        r.put("senderId", b.getLong("senderId"));
        r.put("source", b.getLong("sourceMessageId"));
        r.put("card", b.getLong("cardMessageId"));
        r.put("status", b.getString("status"));
        r.put("revision", b.getLong("revision"));
        r.put("payload", JSON.toJSONString(b, com.alibaba.fastjson.serializer.SerializerFeature.WriteMapNullValue));
        return r;
    }

    private Map<String, Object> taskRow(Long tenant, JSONObject t) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", t.getLong("humanTaskId"));
        r.put("tenant", tenant);
        r.put("group", t.getLong("groupSessionId"));
        r.put("batch", t.getLong("batchId"));
        r.put("actor", t.getLong("initiatorUserId"));
        r.put("assignee", t.getLong("assigneeUserId"));
        r.put("status", t.getString("status"));
        r.put("revision", t.getLong("revision"));
        r.put("version", t.getIntValue("latestVersion"));
        r.put("submission", t.getLong("latestSubmissionId"));
        r.put("payload", t.toJSONString());
        return r;
    }
    /** Shared groups carry explicit business ownership; personal groups deliberately have no enterprise. */

    private void requireGroupScope(Long tenant, Long groupId) {
        var group = sessions.findById(groupId);
        require(group != null, "GROUP_SCOPE_MISMATCH");
        var ownership = extensions.findOneByExtParamCode(groupId, GroupChatApplicationService.BUSINESS_ENTERPRISE_EXT);
        Long owner = group.getEnterpriseId();
        if (ownership != null) {
            String value = ownership.getExtParamValue();
            if ("NONE".equals(value))owner = 0L;
            else {
                require(value != null && value.matches("[1-9][0-9]*"), "GROUP_SCOPE_MISMATCH");
                owner = Long.valueOf(value);
                require(owner.equals(group.getEnterpriseId()), "GROUP_SCOPE_MISMATCH");
            }
        }
        if (owner == null || owner <= 0)owner = 0L;
        require(owner.equals(tenant), "GROUP_SCOPE_MISMATCH");
    }

    private String next() {
        return ids.nextVal().toString();
    }

    private JSONObject parse(String raw) {
        return raw == null?null:JSON.parseObject(raw);
    }

    /** Authoritative columns also hydrate payloads written before the sender upgrade. */
    private JSONObject parseBatch(Map<String, Object> row) {
        if (row == null) return null;
        JSONObject batch = parse(Objects.toString(row.get("payload"), null));
        batch.put("senderType", row.get("senderType"));
        batch.put("senderId", Objects.toString(row.get("senderId"), null));
        return batch;
    }
}
