package com.iwhalecloud.byai.state.domain.groupchat.forward.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatForwardTarget;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;

/** Only final SQL work belongs here; object/source I/O has finished before this separate bean is called. */
@Service
public class GroupChatForwardCommitService {
    private final LegacyGroupChatForwardStore store;
    private final ByaiGroupChatForwardMapper rows;
    private final JdbcTemplate db;
    private final TransactionTemplate transaction;
    private final ObjectMapper json;
    private final SequenceService ids;
    private final GroupChatTopicService topics;
    private final ForwardPlatformPolicy policy;
    private final ForwardManifest manifests;

    public GroupChatForwardCommitService(LegacyGroupChatForwardStore store, ByaiGroupChatForwardMapper rows,
        JdbcTemplate db, PlatformTransactionManager manager, ObjectMapper json, SequenceService ids,
        GroupChatTopicService topics, ForwardPlatformPolicy policy, ForwardUploadReservation locations,
        GroupChatForwardProperties properties) {
        this.store = store; this.rows = rows; this.db = db; this.transaction = new TransactionTemplate(manager);
        this.json = json; this.ids = ids; this.topics = topics; this.policy = policy;
        this.manifests = new ForwardManifest(json, locations, properties.effectiveMaxFileBytes());
    }

    public CommitResult commit(TargetLease lease) {
        return transaction.execute(status -> publish(lease));
    }

    private CommitResult publish(TargetLease lease) {
        long tenant = lease.actor().enterpriseId();
        db.update("UPDATE byai.byai_group_chat_forward_request SET request_id=request_id WHERE enterprise_id=? AND request_id=?", tenant, lease.requestId());
        var request = rows.request(tenant, lease.requestId());
        var before = rows.target(tenant, lease.targetId());
        if (request == null || before == null || !"LEGACY".equals(request.getBackend())
            || request.getActorUserId() != lease.actor().userId() || request.getSourceSessionId() != lease.sourceSessionId()
            || !before.getRequestId().equals(request.getRequestId()) || before.getTargetSessionId() != lease.targetSessionId()) throw denied();
        // The request lock serializes success/maintenance updates; committed receipts need no surviving source access.
        if ("SUCCEEDED".equals(before.getState())) return receipt(before);
        policy.requireNewWork(lease.actor(), ForwardBackend.LEGACY);
        Map<Long, Map<String,Object>> groups = new HashMap<>(), members = new HashMap<>();
        for (long group : new TreeSet<>(List.of(request.getSourceSessionId(), before.getTargetSessionId()))) {
            db.update("UPDATE byai.byai_session SET session_id=session_id WHERE session_id=?", group);
            var found = db.queryForList("SELECT session_id,enterprise_id,session_type,state,project_id FROM byai.byai_session WHERE session_id=?", group);
            groups.put(group, found.isEmpty() ? null : found.getFirst());
            db.update("UPDATE byai.byai_session_member SET mem_obj_id=mem_obj_id WHERE session_id=? AND mem_obj_type='USER' AND mem_obj_id=?", group, lease.actor().userId());
            var membership = db.queryForList("SELECT mem_obj_id,mem_name FROM byai.byai_session_member WHERE session_id=? AND mem_obj_type='USER' AND mem_obj_id=?", group, lease.actor().userId());
            members.put(group, membership.isEmpty() ? null : membership.getFirst());
        }
        var source = identity(groups.get(lease.sourceSessionId()));
        ForwardEligibility.requireSource(lease.actor(), source, members.get(lease.sourceSessionId()) != null);
        ForwardEligibility.requireTarget(lease.actor(), source, identity(groups.get(lease.targetSessionId())), members.get(lease.targetSessionId()) != null);
        db.update("UPDATE byai.byai_group_chat_forward_target SET target_id=target_id WHERE enterprise_id=? AND target_id=?", tenant, lease.targetId());
        var target = rows.target(tenant, lease.targetId());
        if (target == null || !target.getRequestId().equals(request.getRequestId()) || target.getTargetSessionId() != before.getTargetSessionId().longValue()
            || !"READY".equals(target.getState()) || lease.state() != ForwardState.READY || !Objects.equals(target.getLeaseOwner(), lease.owner())
            || target.getFencingVersion() != lease.fencingVersion() || !Boolean.TRUE.equals(request.getSourcesFrozen()) || !"RUNNING".equals(request.getState())
            || db.queryForList("SELECT 1 FROM byai.byai_group_chat_forward_target WHERE enterprise_id=? AND target_id=? AND lease_until>clock_timestamp()", tenant, lease.targetId()).isEmpty()) throw lost();
        var snapshot = read(request.getFrozenJson(), PreparedSnapshot.class);
        // 同值更新选中的外层消息，在最终校验至事务提交之间串行处理撤回、归档与删除。
        for (long selected : new TreeSet<>(snapshot.selectedMessageIds())) {
            db.update("UPDATE byai.byai_message SET message_id=message_id WHERE session_id=? AND message_id=?", request.getSourceSessionId(), selected);
            var found = db.queryForList("SELECT usage,recalled_at,archived_at FROM byai.byai_message WHERE session_id=? AND message_id=?", request.getSourceSessionId(), selected);
            if (found.size() != 1 || found.getFirst().get("recalled_at") != null || found.getFirst().get("archived_at") != null
                || !Set.of(1, 2).contains(((Number) found.getFirst().get("usage")).intValue())) throw denied();
        }
        var manifest = read(request.getSourceManifestJson(), SourceManifest.class);
        var checkpoint = read(target.getCheckpointJson(), ObjectNode.class);
        manifests.ready(checkpoint, manifest, lease);
        var items = rows.items(tenant, target.getTargetId()).stream().map(i -> new ForwardItem(i.getItemId().toString(), i.getSelectedMessageId(), i.getSelectedMergedCard(),
            i.getSourceMessageId(), i.getOrdinal(), i.getContent(), read(i.getSpeakerJson(), ForwardSpeaker.class), i.getSourceCreatedAt().toString(),
            Arrays.asList(read(i.getReferencesJson(), ForwardReference[].class)), List.of())).toList();
        if (items.isEmpty() || items.size() > 100 || items.stream().anyMatch(i -> !snapshot.selectedMessageIds().contains(i.selectedMessageId()))) throw denied();
        List<List<ForwardItem>> batches = new ArrayList<>();
        if ("MERGED".equals(request.getMode())) batches.add(items);
        else {
            Map<Long,List<ForwardItem>> selected = new LinkedHashMap<>();
            items.forEach(i -> selected.computeIfAbsent(i.selectedMessageId(), key -> new ArrayList<>()).add(i));
            batches.addAll(selected.values());
        }
        List<Long> messageIds = new ArrayList<>();
        for (var batch : batches) {
            long id = ids.nextVal();
            boolean merged = "MERGED".equals(request.getMode()) || batch.getFirst().selectedMergedCard();
            if (!merged && batch.size() != 1) throw denied();
            var bound = batch.stream().map(i -> bind(i, manifest, checkpoint, lease, id)).toList();
            Map<String,Object> forward = new LinkedHashMap<>();
            forward.put("forwardId", target.getTargetId().toString()); forward.put("mode", request.getMode());
            forward.put("resourceMode", "SNAPSHOT_ONLY"); forward.put("itemCount", bound.size());
            if (merged) {
                forward.put("title", "聊天记录");
                forward.put("preview", bound.stream().limit(3).map(i -> Map.of("speakerName", i.speaker().name(), "content", preview(i))).toList());
            }
            var message = new ByaiMessage();
            message.setId(id); message.setMessageId(id); message.setSessionId(lease.targetSessionId()); message.setEnterpriseId(tenant);
            Object project = groups.get(lease.targetSessionId()).get("project_id");
            if (project instanceof Number number) message.setProjectId(number.longValue());
            message.setCreatorId(lease.actor().userId());
            message.setCreatorName(Objects.toString(members.get(lease.targetSessionId()).get("mem_name"), Long.toString(lease.actor().userId())));
            message.setUsage(1); message.setRole("user"); message.setIsComplete(true); message.setMsgStatus(0);
            message.setCreateTime(new Date()); message.setUpdateTime(new Date()); message.setMessageRef(null);
            message.setMessageContent(merged ? "聊天记录（" + bound.size() + " 条）" : bound.getFirst().content());
            message.setMetadata(write(Map.of("scene", "GROUP_CHAT", "kind", merged ? "FORWARD_MERGED" : "FORWARD_SINGLE", "forward", forward,
                "resourceList", merged ? List.of() : bound.getFirst().resourceList(),
                "files", merged ? List.of() : bound.getFirst().attachments().stream().filter(a -> a.cloudResourceId()!=null).toList())));
            if (!merged && !bound.getFirst().attachments().isEmpty()) message.setRelatedResources(write(Map.of("files", bound.getFirst().attachments().stream().filter(a -> a.cloudResourceId()==null).toList())));
            topics.persistMessage(message);
            for (var item : bound) {
                if (rows.bindItem(tenant, lease.targetId(), Long.parseLong(item.itemId()), lease.owner(), lease.fencingVersion(), id, write(item.attachments())) != 1) throw lost();
                if (db.update("UPDATE byai.byai_group_chat_forward_item SET references_json=?,content=? WHERE enterprise_id=? AND target_id=? AND item_id=? AND bound_message_id=?", write(item.resourceList()),item.content(), tenant, lease.targetId(), Long.parseLong(item.itemId()), id) != 1) throw lost();
            }
            messageIds.add(id);
        }
        if (rows.succeedTarget(tenant, lease.targetId(), lease.owner(), lease.fencingVersion(), write(messageIds.stream().map(String::valueOf).toList())) != 1) throw lost();
        // No checkpoint replacement here: CURRENT maintenance fields survive the commit exactly.
        store.recompute(request);
        return receipt(rows.target(tenant, lease.targetId()));
    }

    private ForwardItem bind(ForwardItem item, SourceManifest manifest, ObjectNode checkpoint, TargetLease lease, long messageId) {
        var bindings = manifest.attachments().stream().filter(a -> a.targetId().equals(Long.toString(lease.targetId())) && a.itemId().equals(item.itemId())).toList();
        List<ForwardAttachment> attachments = new ArrayList<>();
        Map<String,ForwardAttachment> references = new HashMap<>();
        for (var binding : bindings) {
            ForwardUploadedFile uploaded = null;
            for (var attempt : checkpoint.path("attempts")) {
                var value = attempt.path("object");
                if ("VERIFIED".equals(attempt.path("state").asText()) && binding.sourceId().equals(attempt.path("sourceId").asText())
                    && item.itemId().equals(value.path("itemId").asText()) && binding.attachmentId().equals(value.path("attachmentId").asText()))
                    uploaded = json.convertValue(value, ForwardUploadedFile.class);
            }
            if (uploaded == null) throw lost();
            var attachment = ForwardUploadedFiles.attachment(uploaded);
            attachments.add(attachment);
            binding.referenceKeys().forEach(key -> references.put(key,attachment));
        }
        Map<String,String> replaced = new HashMap<>();
        var resourceList = item.resourceList().stream().map(ref -> {
            var file=references.get(ref.id());
            if(file==null)return ref;
            var target=ForwardUploadedFiles.reference(file);replaced.put(ref.id(),target.id());return target;
        }).toList();
        return new ForwardItem(item.itemId(),item.selectedMessageId(),item.selectedMergedCard(),item.sourceMessageId(),item.ordinal(),
            ForwardUploadedFiles.replaceTokens(item.content(),replaced),item.speaker(),item.createdAt(),resourceList,attachments);
    }
    private static String preview(ForwardItem item) {
        String value = new ForwardSnapshotFactory().projectText(new ForwardItemTemplate("", item.selectedMessageId(), item.selectedMergedCard(), item.sourceMessageId(), item.ordinal(), item.content(), item.speaker(), item.createdAt(), item.resourceList()));
        return value.substring(0, value.offsetByCodePoints(0, Math.min(120, value.codePointCount(0, value.length()))));
    }
    private static ForwardEligibility.GroupIdentity identity(Map<String,Object> row) {
        return row == null ? null : new ForwardEligibility.GroupIdentity(((Number) row.get("session_id")).longValue(), row.get("enterprise_id") == null ? null : ((Number) row.get("enterprise_id")).longValue(), (String) row.get("session_type"), (String) row.get("state"));
    }
    private CommitResult receipt(ByaiGroupChatForwardTarget target) {
        return new CommitResult(target.getTargetId(), Arrays.stream(read(target.getMessageIdsJson(), String[].class)).map(Long::parseLong).toList(), ForwardState.SUCCEEDED, Boolean.TRUE.equals(target.getPendingDelivery()));
    }
    private String write(Object value) { try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalArgumentException("FORWARD_ENCODING_FAILED", e); } }
    private <T> T read(String value, Class<T> type) { try { return json.readValue(value, type); } catch (Exception e) { throw new IllegalArgumentException("FORWARD_ENCODING_FAILED", e); } }
    private static IllegalArgumentException denied() { return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"); }
    private static IllegalArgumentException lost() { return new IllegalArgumentException("FORWARD_LEASE_LOST"); }
}
