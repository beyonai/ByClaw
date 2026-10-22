package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardRuntimeProjection;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatRecallProjection;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMessageAck;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMessageAckMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatContextTokenService;

/**
 * 从 byai_session/byai_message 构建一次有边界、可鉴权的群聊快照。
 */
@Service
public class GroupChatContextService {

    private static final int DEFAULT_MAX_MESSAGES = 60;

    private static final int MAX_MESSAGES = 60;

    private static final int DEFAULT_MAX_CHARACTERS = 30_000;

    private static final int MAX_CHARACTERS = 30_000;

    private static final Pattern RESOURCE_ID_PATTERN = Pattern.compile("\\d+");

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ByaiGroupChatTaskMapper taskMapper;

    @Autowired
    private UserService userService;

    private final ByaiMessageMapper messageMapper;

    private final SessionService sessionService;

    private final SsResourceService resourceService;
    private final SessionMemberService memberService;
    private final GroupChatContextTokenService tokenService;
    private final ByaiGroupChatMessageAckMapper ackMapper;

    public GroupChatContextService(ByaiMessageMapper messageMapper, SessionService sessionService,
        SsResourceService resourceService, SessionMemberService memberService, GroupChatContextTokenService tokenService) {
        this(messageMapper, sessionService, resourceService, memberService, tokenService, null);
    }

    @Autowired
    public GroupChatContextService(ByaiMessageMapper messageMapper, SessionService sessionService,
        SsResourceService resourceService, SessionMemberService memberService, GroupChatContextTokenService tokenService,
        ByaiGroupChatMessageAckMapper ackMapper) {
        this.messageMapper = messageMapper;
        this.sessionService = sessionService;
        this.resourceService = resourceService;
        this.memberService = memberService;
        this.tokenService = tokenService;
        this.ackMapper = ackMapper;
    }

    /** 兼容既有单元测试和历史构造方式。 */
    public GroupChatContextService(ByaiMessageMapper messageMapper, SessionService sessionService,
        SsResourceService resourceService) {
        this(messageMapper, sessionService, resourceService, null, null);
    }

    /** Agent 上下文始终只选择对话消息，事件不会挤占快照窗口。 */
    public GroupChatContextResponse load(GroupChatContextRequest request) {
        return load(request, false);
    }

    /** 用户会话历史包含已持久化的系统事件。 */
    public GroupChatContextResponse loadTimeline(GroupChatContextRequest request) {
        return load(request, true);
    }

    private GroupChatContextResponse load(GroupChatContextRequest request, boolean timeline) {
        Long sessionId = parseRequiredLong(request == null ? null : request.getConversationKey(), "conversationKey");
        Long beforeMessageId = parseOptionalLong(request == null ? null : request.getBeforeMessageId());
        if (beforeMessageId == null) {
            beforeMessageId = Objects.requireNonNullElse(messageMapper.selectLatestMessageId(sessionId), 0L) + 1;
        }
        requireGroupMember(sessionId, request);

        int maxMessages = bounded(request.getMaxMessages(), DEFAULT_MAX_MESSAGES, MAX_MESSAGES);
        int maxCharacters = bounded(request.getMaxCharacters(), DEFAULT_MAX_CHARACTERS, MAX_CHARACTERS);
        long totalCount = Objects.requireNonNullElse(
            timeline ? messageMapper.countTimelineBeforeMessageId(sessionId, beforeMessageId)
                : messageMapper.countVisibleBeforeMessageId(sessionId, beforeMessageId), 0L);
        List<ByaiMessage> newestFirst = timeline
            ? messageMapper.selectTimelineBeforeMessageId(sessionId, beforeMessageId, maxMessages)
            : messageMapper.selectVisibleBeforeMessageId(sessionId, beforeMessageId, maxMessages);
        if (newestFirst == null) {
            newestFirst = Collections.emptyList();
        }
        List<ByaiMessage> ordered = new ArrayList<>(newestFirst);
        Collections.reverse(ordered);

        GroupChatRecallProjection projection = new GroupChatRecallProjection();
        // 字符预算只计算用户可见内容，隐藏原文不能挤占历史窗口。
        ordered.replaceAll(projection::display);
        boolean characterTruncated = trimToCharacterLimit(ordered, maxCharacters);
        List<GroupChatContextResponse.Message> messages = toMessages(ordered, null, projection);
        if (characterTruncated && messages.size() == 1) {
            GroupChatContextResponse.Message message = messages.get(0);
            String content = message.getContent();
            if (content.length() > maxCharacters) {
                // 只裁剪安全投影后的响应正文，保留原始消息 ID 供下一页继续读取更早历史。
                String notice = message.isRecalled() ? "" : "…（消息过长，已截断预览）";
                message.setContent(content.substring(0, Math.max(0, maxCharacters - notice.length()))
                    + notice.substring(0, Math.min(maxCharacters, notice.length())));
            }
        }
        if (!timeline) {
            // 引用独立查询，不能绕过 Agent 主查询的系统事件排除规则。
            messages.forEach(message -> {
                if (message.getReplyTo() != null && Integer.valueOf(5).equals(message.getReplyTo().getUsage())) {
                    message.setReplyTo(null);
                }
            });
        }

        GroupChatContextResponse response = new GroupChatContextResponse();
        response.setConversationKey(String.valueOf(sessionId));
        response.setMessages(messages);

        GroupChatContextResponse.Snapshot snapshot = new GroupChatContextResponse.Snapshot();
        snapshot.setBeforeMessageId(String.valueOf(beforeMessageId));
        if (!messages.isEmpty()) {
            snapshot.setLastIncludedMessageId(messages.get(messages.size() - 1).getMessageId());
        }
        snapshot.setGeneratedAt(System.currentTimeMillis());
        response.setSnapshot(snapshot);

        int omitted = Math.max(0, Math.toIntExact(Math.min(Integer.MAX_VALUE, totalCount - messages.size())));
        GroupChatContextResponse.Truncation truncation = new GroupChatContextResponse.Truncation();
        truncation.setTruncated(omitted > 0 || characterTruncated);
        truncation.setOmittedMessageCount(omitted);
        if (characterTruncated) {
            truncation.setReason("character_limit");
        }
        else if (omitted > 0) {
            truncation.setReason("message_limit");
        }
        response.setTruncation(truncation);
        return response;
    }

    private void requireGroupMember(Long sessionId, GroupChatContextRequest request) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || GroupChatAuthorizationService.DISSOLVED_STATE.equals(session.getState())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
        }
        String contextToken = request == null ? null : request.getContextToken();
        if (contextToken != null && tokenService != null) {
            Map<String, Object> claims = tokenService.verify(contextToken);
            if (request == null || request.getChildSessionId() == null || request.getInitiatorUserId() == null
                || request.getTargetAgentId() == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            if (!String.valueOf(sessionId).equals(String.valueOf(claims.get("groupSessionId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            if (request.getInitiatorUserId() != null
                && !String.valueOf(request.getInitiatorUserId()).equals(String.valueOf(claims.get("initiatorUserId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            if (request.getTargetAgentId() != null
                && !String.valueOf(request.getTargetAgentId()).equals(String.valueOf(claims.get("targetAgentId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            if (!String.valueOf(request.getChildSessionId()).equals(String.valueOf(claims.get("childSessionId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            Object boundary = claims.get("boundaryMessageId");
            Long requestedBefore = parseRequiredLong(request.getBeforeMessageId(), "beforeMessageId");
            if (boundary != null && requestedBefore > Long.parseLong(String.valueOf(boundary))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
            }
            return;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        boolean member = memberService != null
            && memberService.findSessionMember(sessionId, MemObjType.USER.name(), currentUserId) != null;
        if (session == null || (memberService != null && !member)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, I18nUtil.get("groupchat.context.notFound"));
        }
    }

    private boolean trimToCharacterLimit(List<ByaiMessage> ordered, int maxCharacters) {
        int characters = ordered.stream()
            .map(ByaiMessage::getMessageContent)
            .filter(Objects::nonNull)
            .mapToInt(String::length)
            .sum();
        boolean truncated = false;
        // 最新消息单独超限时仍保留身份，正文在响应投影后裁剪，避免历史翻页丢失游标。
        while (ordered.size() > 1 && characters > maxCharacters) {
            ByaiMessage removed = ordered.remove(0);
            characters -= StringUtils.defaultString(removed.getMessageContent()).length();
            truncated = true;
        }
        return truncated || characters > maxCharacters;
    }

    /** 将已鉴权的公开群消息转换为统一的前端消息协议。 */
    public List<GroupChatContextResponse.Message> toMessages(List<ByaiMessage> ordered) {
        return toMessages(ordered, null);
    }

    /** 话题页传入已过滤的引用快照，避免逐条查询及隐藏父消息内容泄漏。 */
    public List<GroupChatContextResponse.Message> toMessages(List<ByaiMessage> ordered,
        Map<Long, ByaiMessage> visibleReferences) {
        return toMessages(ordered, visibleReferences, new GroupChatRecallProjection());
    }

    private List<GroupChatContextResponse.Message> toMessages(List<ByaiMessage> ordered,
        Map<Long, ByaiMessage> visibleReferences, GroupChatRecallProjection projection) {
        List<GroupChatContextResponse.Message> result = new ArrayList<>(ordered.size());
        Map<Long, SsResource> resources = new HashMap<>();
        Map<Long, String> cloudResources = new HashMap<>();
        Map<Long, ByaiGroupChatTask> tasks = loadMessageTasks(ordered);
        Map<Long, List<ByaiGroupChatMessageAck>> acknowledgements = loadAcknowledgements(ordered);
        Map<Long, ByaiMessage> references = loadReferences(ordered, visibleReferences);
        List<ByaiMessage> speakers = new ArrayList<>(ordered);
        references.values().stream().filter(Objects::nonNull).forEach(speakers::add);
        Map<Long, Map<Long, String>> displayNames = loadSpeakerDisplayNames(speakers);
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        for (int index = 0; index < ordered.size(); index++) {
            ByaiMessage source = projection.display(ordered.get(index));
            GroupChatContextResponse.Message message = new GroupChatContextResponse.Message();
            message.setMessageId(String.valueOf(source.getMessageId()));
            message.setRecalled(source.isRecalled());
            message.setRecall(projection.recall(source.getRecalledAt(), source.getRecalledBy()));
            message.setTopicId(source.getTopicId() == null ? null : String.valueOf(source.getTopicId()));
            message.setSequence(index);
            message.setCreatedAt(source.getCreateTime() == null ? 0L : source.getCreateTime().getTime());
            message.setContent(StringUtils.defaultString(source.getMessageContent()));
            message.setResourceList(toMemberResources(source.getMetadata()));
            boolean passive = ForwardRuntimeProjection.isSnapshotOnly(source.getMetadata());
            message.setForward(source.isRecalled() ? null : ForwardRuntimeProjection.publicForward(ForwardRuntimeProjection.metadata(source.getMetadata())));
            List<ByaiGroupChatMessageAck> messageAcks = passive || source.isRecalled() ? List.of() : acknowledgements.getOrDefault(source.getMessageId(), List.of());
            message.setAcknowledgements(messageAcks.stream().map(this::toAcknowledgement).toList());
            message.setCanAcknowledge(!passive && currentUserId != null
                && !currentUserId.equals(source.getCreatorId())
                && message.getResourceList().stream().anyMatch(resource -> "HUMAN".equals(resource.getResourceType())
                    && String.valueOf(currentUserId).equals(String.valueOf(resource.getResourceId())))
                && messageAcks.stream().noneMatch(ack -> currentUserId.equals(ack.getUserId())));
            message.setClientRequestId(toClientRequestId(source.getMetadata()));
            message.setGroupCoordination(passive ? null : toCoordination(source.getMetadata()));
            message.setTaskId(passive ? null : toMetadataString(source.getMetadata(), "taskId"));
            message.setUsage(source.getUsage());
            message.setKind(Integer.valueOf(5).equals(source.getUsage()) ? "SYSTEM_EVENT"
                : toMetadataString(source.getMetadata(), "kind"));
            if (Integer.valueOf(5).equals(source.getUsage())) {
                message.setSystemEvent(toSystemEvent(source.getMetadata()));
            }
            ByaiGroupChatTask task = tasks.get(messageTaskId(source));
            // 归属以任务记录为准，不使用发言 Agent、发布人或客户端 metadata 中的用户 ID。
            if (!passive && task != null && Objects.equals(task.getGroupSessionId(), source.getSessionId())
                && task.getInitiatorUserId() != null) {
                message.setInitiatorUserId(String.valueOf(task.getInitiatorUserId()));
            }
            message.setTarget(passive ? null : toTarget(source));
            message.setRole(toRole(source.getUsage()));
            message.setSpeaker(toSpeaker(source, resources, displayNames));
            message.setAttachments(source.isRecalled() ? List.of() : toAttachments(source, cloudResources));
            if (!passive && source.getMessageRef() != null) {
                ByaiMessage referenced = references.get(source.getMessageRef());
                if (referenced != null && Objects.equals(source.getSessionId(), referenced.getSessionId())) {
                    GroupChatContextResponse.ReplyReference reply = new GroupChatContextResponse.ReplyReference();
                    reply.setMessageId(String.valueOf(referenced.getMessageId()));
                    boolean hidden = source.isRecalled() || referenced.isRecalled();
                    reply.setRecalled(referenced.isRecalled());
                    reply.setContent(hidden ? I18nUtil.get(GroupChatRecallProjection.RECALLED_REFERENCE)
                        : StringUtils.defaultString(referenced.getMessageContent()));
                    reply.setResourceList(hidden ? List.of() : toMemberResources(referenced.getMetadata()));
                    reply.setForward(hidden ? null : ForwardRuntimeProjection.publicForward(ForwardRuntimeProjection.metadata(referenced.getMetadata())));
                    if (ForwardRuntimeProjection.isSnapshotOnly(referenced.getMetadata())) {
                        reply.setAcknowledgements(List.of()); reply.setCanAcknowledge(false);
                    }
                    reply.setUsage(referenced.getUsage());
                    reply.setRole(toRole(referenced.getUsage()));
                    reply.setSpeaker(toSpeaker(referenced, resources, displayNames));
                    message.setReplyTo(reply);
                }
            }
            result.add(message);
        }
        return result;
    }

    /** 只收集实际展示的同群引用，话题页的可见引用边界不能被额外查询绕过。 */
    private Map<Long, ByaiMessage> loadReferences(List<ByaiMessage> messages, Map<Long, ByaiMessage> visibleReferences) {
        Map<Long, ByaiMessage> references = new HashMap<>();
        for (ByaiMessage message : messages) {
            Long referenceId = message.getMessageRef();
            if (referenceId == null || ForwardRuntimeProjection.isSnapshotOnly(message.getMetadata())
                || references.containsKey(referenceId)) continue;
            ByaiMessage reference = visibleReferences == null ? messageMapper.selectByMessageId(referenceId)
                : visibleReferences.get(referenceId);
            references.put(referenceId, reference != null && Objects.equals(message.getSessionId(), reference.getSessionId())
                ? reference : null);
        }
        return references;
    }

    /** 每次查询按群批量读取当前昵称，缺失时批量回退平台用户名，不修改消息中的姓名快照。 */
    private Map<Long, Map<Long, String>> loadSpeakerDisplayNames(List<ByaiMessage> messages) {
        List<ByaiMessage> userMessages = messages.stream().filter(message -> Integer.valueOf(1).equals(message.getUsage()))
            .filter(message -> message.getSessionId() != null && message.getCreatorId() != null).toList();
        Map<Long, Map<Long, String>> names = new HashMap<>();
        userMessages.stream().map(ByaiMessage::getSessionId).distinct().forEach(sessionId -> {
            Map<Long, String> groupNames = new HashMap<>();
            if (memberService != null) {
                memberService.findSessionMembers(sessionId, MemObjType.USER.name(), null).stream()
                    .filter(member -> Objects.equals(sessionId, member.getSessionId())
                        && MemObjType.USER.name().equals(member.getMemObjType()) && member.getMemObjId() != null
                        && StringUtils.isNotBlank(member.getMemName()))
                    .forEach(member -> groupNames.put(member.getMemObjId(), member.getMemName()));
            }
            names.put(sessionId, groupNames);
        });
        List<Long> missingUserIds = userMessages.stream()
            .filter(message -> !names.get(message.getSessionId()).containsKey(message.getCreatorId()))
            .map(ByaiMessage::getCreatorId).distinct().toList();
        Map<Long, String> userNames = new HashMap<>();
        if (userService != null && !missingUserIds.isEmpty()) {
            userService.findByIds(missingUserIds).stream()
                .filter(user -> user.getUserId() != null && StringUtils.isNotBlank(user.getUserName()))
                .forEach(user -> userNames.put(user.getUserId(), user.getUserName()));
        }
        userMessages.forEach(message -> names.get(message.getSessionId()).putIfAbsent(message.getCreatorId(),
            userNames.getOrDefault(message.getCreatorId(), I18nUtil.get("groupchat.memberFallback"))));
        return names;
    }

    private Map<Long, List<ByaiGroupChatMessageAck>> loadAcknowledgements(List<ByaiMessage> messages) {
        if (ackMapper == null || messages.isEmpty()) return Map.of();
        List<Long> ids = messages.stream().map(ByaiMessage::getMessageId).filter(Objects::nonNull).toList();
        List<ByaiGroupChatMessageAck> acknowledgements = ackMapper.selectByMessageIds(messages.get(0).getSessionId(), ids);
        Map<Long, String> userNames = new HashMap<>();
        List<Long> missingUserIds = acknowledgements.stream().map(ByaiGroupChatMessageAck::getUserId)
            .filter(Objects::nonNull).distinct().filter(userId -> {
                try {
                    ShareBfmUser cached = ShareCacheUtil.getShareBfmUser(userId);
                    if (cached != null && cached.getUserName() != null && !cached.getUserName().isBlank()) {
                        userNames.put(userId, cached.getUserName());
                        return false;
                    }
                }
                catch (RuntimeException ignored) {
                    // Redis 不可用或缓存数据异常时统一批量回退数据库。
                }
                return true;
            }).toList();
        if (userService != null && !missingUserIds.isEmpty()) {
            userService.findByIds(missingUserIds).stream()
                .filter(user -> user.getUserId() != null && user.getUserName() != null && !user.getUserName().isBlank())
                .forEach(user -> userNames.put(user.getUserId(), user.getUserName()));
        }
        Map<Long, List<ByaiGroupChatMessageAck>> result = new HashMap<>();
        acknowledgements.forEach(ack -> {
            String userName = userNames.get(ack.getUserId());
            if (userName != null) ack.setUserName(userName);
            result.computeIfAbsent(ack.getMessageId(), ignored -> new ArrayList<>()).add(ack);
        });
        return result;
    }

    private GroupChatContextResponse.MessageAcknowledgement toAcknowledgement(ByaiGroupChatMessageAck ack) {
        GroupChatContextResponse.MessageAcknowledgement result = new GroupChatContextResponse.MessageAcknowledgement();
        result.setMessageId(String.valueOf(ack.getMessageId()));
        result.setUserId(String.valueOf(ack.getUserId()));
        String userName = ack.getUserName();
        result.setUserName(userName == null || userName.isBlank() || userName.equals(String.valueOf(ack.getUserId()))
            ? I18nUtil.get("groupchat.memberFallback") : userName);
        result.setAcknowledgedAt(ack.getAcknowledgedAt() == null ? null : ack.getAcknowledgedAt().getTime());
        return result;
    }

    /** 同一页的任务回执和结果去重后批量查询，兼容未保存归属信息的历史消息。 */
    private Map<Long, ByaiGroupChatTask> loadMessageTasks(List<ByaiMessage> messages) {
        List<Long> ids = messages.stream().map(this::messageTaskId).filter(Objects::nonNull).distinct().toList();
        Map<Long, ByaiGroupChatTask> tasks = new HashMap<>();
        if (!ids.isEmpty()) {
            for (ByaiGroupChatTask task : taskMapper.selectBatchIds(ids)) {
                tasks.put(task.getTaskSessionId(), task);
            }
        }
        return tasks;
    }

    private Long messageTaskId(ByaiMessage message) {
        String kind = toMetadataString(message.getMetadata(), "kind");
        if (!Integer.valueOf(2).equals(message.getUsage())
            || !("TASK_RESULT".equals(kind) || "TASK_ACK".equals(kind))) {
            return null;
        }
        String taskId = toMetadataString(message.getMetadata(), "taskId");
        try {
            return taskId == null ? null : Long.valueOf(taskId);
        }
        catch (NumberFormatException ignored) {
            // 旧消息的无效任务引用不应阻断整页历史，也不能据此猜测任务归属。
            return null;
        }
    }

    private String toRole(Integer usage) {
        return Integer.valueOf(5).equals(usage) ? "event" : Integer.valueOf(1).equals(usage) ? "user" : "assistant";
    }

    private GroupChatContextResponse.SystemEvent toSystemEvent(String metadata) {
        try {
            JSONObject object = JSON.parseObject(metadata);
            return object == null ? null : object.getObject("systemEvent", GroupChatContextResponse.SystemEvent.class);
        }
        catch (RuntimeException ignored) {
            // 元数据缺失或损坏时仍保留事件正文，不能伪装成 Agent 回复。
            return null;
        }
    }

    private String toClientRequestId(String metadata) {
        return toMetadataString(metadata, "clientRequestId");
    }

    private Map<String, Object> toCoordination(String metadata) {
        try {
            JSONObject object = JSON.parseObject(metadata);
            return object == null ? null : object.getJSONObject("groupCoordination");
        }
        catch (RuntimeException ignored) {
            return null;
        }
    }

    private String toMetadataString(String metadata, String key) {
        if (StringUtils.isBlank(metadata)) {
            return null;
        }
        try {
            JSONObject object = JSON.parseObject(metadata);
            return object == null ? null : object.getString(key);
        }
        catch (RuntimeException ignored) {
            return null;
        }
    }

    /** 历史资源来自入站消息保存的 metadata，旧消息缺失或损坏时保留可读正文。 */
    private List<ResourceVo> toMemberResources(String metadata) {
        if (StringUtils.isBlank(metadata)) {
            return Collections.emptyList();
        }
        if (ForwardRuntimeProjection.isSnapshotOnly(metadata)) return ForwardRuntimeProjection.displayResources(ForwardRuntimeProjection.metadata(metadata));
        try {
            JSONObject object = JSON.parseObject(metadata);
            JSONArray resourceList = object == null ? null : object.getJSONArray("resourceList");
            return resourceList == null ? Collections.emptyList() : resourceList.toJavaList(ResourceVo.class);
        }
        catch (RuntimeException ignored) {
            return Collections.emptyList();
        }
    }

    private GroupChatContextResponse.Target toTarget(ByaiMessage source) {
        if (StringUtils.isBlank(source.getMetadata())) {
            return null;
        }
        try {
            Map<?, ?> metadata = JSON.parseObject(source.getMetadata(), Map.class);
            Object targetAgentId = metadata.get("targetAgentId");
            if (targetAgentId == null) {
                return null;
            }
            GroupChatContextResponse.Target target = new GroupChatContextResponse.Target();
            target.setAgentId(String.valueOf(targetAgentId));
            return target;
        }
        catch (Exception ignored) {
            return null;
        }
    }

    private GroupChatContextResponse.Speaker toSpeaker(ByaiMessage message, Map<Long, SsResource> resources,
        Map<Long, Map<Long, String>> displayNames) {
        GroupChatContextResponse.Speaker speaker = new GroupChatContextResponse.Speaker();
        if (Integer.valueOf(5).equals(message.getUsage())) {
            speaker.setType("system");
            speaker.setDisplayName(I18nUtil.get("groupchat.system"));
            return speaker;
        }
        if (Integer.valueOf(1).equals(message.getUsage())) {
            speaker.setType("user");
            speaker.setUserCode(resolveUserCode(message));
            Map<Long, String> groupNames = displayNames.get(message.getSessionId());
            speaker.setDisplayName(StringUtils.defaultIfBlank(groupNames == null ? null : groupNames.get(message.getCreatorId()),
                I18nUtil.get("groupchat.memberFallback")));
            return speaker;
        }

        speaker.setType("agent");
        Long agentId = resolveAgentId(message);
        speaker.setAgentId(agentId == null ? "unknown" : String.valueOf(agentId));
        String agentName = null;
        if (agentId != null) {
            SsResource resource = resources.computeIfAbsent(agentId, resourceService::findById);
            agentName = resource == null ? null : resource.getResourceName();
        }
        speaker.setAgentName(StringUtils.defaultIfBlank(agentName,
            StringUtils.defaultIfBlank(message.getCreatorName(), "Assistant")));
        return speaker;
    }

    private String resolveUserCode(ByaiMessage message) {
        if (Objects.equals(message.getCreatorId(), CurrentUserHolder.getCurrentUserId())
                && StringUtils.isNotBlank(CurrentUserHolder.getCurrentUserCode())) {
            return CurrentUserHolder.getCurrentUserCode();
        }
        return String.valueOf(message.getCreatorId());
    }

    private Long resolveAgentId(ByaiMessage message) {
        if (message.getResComId() != null) {
            return message.getResComId();
        }
        // 旧群聊回复只在 metadata 中保存执行员工，不能从被 @ 的资源列表推断发言者。
        if (StringUtils.isNotBlank(message.getMetadata())) {
            try {
                JSONObject metadata = JSON.parseObject(message.getMetadata());
                if (metadata != null && "GROUP_CHAT".equals(metadata.getString("scene"))) {
                    String targetAgentId = metadata.getString("targetAgentId");
                    if (StringUtils.isNotBlank(targetAgentId)) {
                        return Long.valueOf(targetAgentId);
                    }
                    // 旧任务回执/结果未保存 targetAgentId，其 creatorId 由群任务服务写为员工 ID。
                    if ("TASK_ACK".equals(metadata.getString("kind"))
                            || "TASK_RESULT".equals(metadata.getString("kind"))) {
                        return message.getCreatorId();
                    }
                }
            }
            catch (RuntimeException ignored) {
                // 无效旧元数据不应阻断整页历史，继续尝试原有资源字段。
            }
        }
        Matcher matcher = RESOURCE_ID_PATTERN.matcher(StringUtils.defaultString(message.getResComIds()));
        if (!matcher.find()) {
            return null;
        }
        try {
            return Long.valueOf(matcher.group());
        }
        catch (NumberFormatException ignored) {
            return null;
        }
    }

    /** 文件列表只读取 related_resources，避免混入任务结果元数据中的云盘文件。 */
    public Map<Long, List<GroupChatContextResponse.Attachment>> relatedResourceAttachmentsForMessages(
        List<ByaiMessage> messages) {
        Map<Long, List<GroupChatContextResponse.Attachment>> result = new HashMap<>();
        for (ByaiMessage message : messages) {
            result.put(message.getMessageId(), message.isRecalled() ? List.of()
                : Objects.requireNonNullElseGet(toAttachments(message.getRelatedResources()), List::of));
        }
        return result;
    }

    /** 批量复用时间线附件投影，避免列表为每条消息重复查询历史云盘信息。 */
    public Map<Long, List<GroupChatContextResponse.Attachment>> attachmentsForMessages(List<ByaiMessage> messages) {
        Map<Long, List<GroupChatContextResponse.Attachment>> result = new HashMap<>();
        Map<Long, String> cloudResources = new HashMap<>();
        for (ByaiMessage message : messages) {
            result.put(message.getMessageId(), message.isRecalled() ? List.of()
                : Objects.requireNonNullElseGet(toAttachments(message, cloudResources), List::of));
        }
        return result;
    }

    private List<GroupChatContextResponse.Attachment> toAttachments(ByaiMessage source,
        Map<Long, String> cloudResources) {
        if ("FORWARD_MERGED".equals(ForwardRuntimeProjection.metadata(source.getMetadata()).path("kind").asText())) return List.of();
        List<GroupChatContextResponse.Attachment> legacy = toAttachments(source.getRelatedResources());
        List<GroupChatContextResponse.Attachment> result = legacy == null ? new ArrayList<>() : new ArrayList<>(legacy);
        JSONObject metadata;
        try {
            metadata = JSON.parseObject(source.getMetadata());
        }
        catch (RuntimeException ignored) {
            // 历史元数据损坏时仍返回普通附件，不影响整页消息。
            return legacy;
        }
        // 普通群消息可能没有 kind，使用空值安全的比较保留原有附件。
        String kind = metadata == null ? null : metadata.getString("kind");
        if (metadata == null || !"GROUP_CHAT".equals(metadata.getString("scene"))
            || !("TASK_RESULT".equals(kind) || "FORWARD_SINGLE".equals(kind))
            || !(metadata.get("files") instanceof JSONArray)) {
            return legacy;
        }
        for (Object value : metadata.getJSONArray("files")) {
            if (!(value instanceof JSONObject)) {
                continue;
            }
            JSONObject file = (JSONObject) value;
            String name = file.getString("fileName");
            String path = file.getString("filePath");
            if (StringUtils.isBlank(name) || StringUtils.isBlank(path)) {
                continue;
            }
            GroupChatContextResponse.Attachment attachment = new GroupChatContextResponse.Attachment();
            attachment.setFileId(file.getString("fileId"));
            attachment.setFileName(name);
            attachment.setFilePath(path);
            String cloudResourceId = file.getString("cloudResourceId");
            if (StringUtils.isBlank(cloudResourceId)) {
                // 旧发布消息未保存知识库 ID，按所属群项目补齐；一页内同群只查询一次。
                if (!cloudResources.containsKey(source.getSessionId())) {
                    ByaiSession group = sessionService.findById(source.getSessionId());
                    Project project = group == null || group.getProjectId() == null ? null
                        : projectService.findById(group.getProjectId());
                    cloudResources.put(source.getSessionId(), project == null || project.getCloudResourceId() == null
                        ? null : String.valueOf(project.getCloudResourceId()));
                }
                cloudResourceId = cloudResources.get(source.getSessionId());
            }
            attachment.setCloudResourceId(cloudResourceId);
            result.add(attachment);
        }
        return result.isEmpty() ? null : result;
    }

    private List<GroupChatContextResponse.Attachment> toAttachments(String relatedResources) {
        if (StringUtils.isBlank(relatedResources)) return null;
        try {
            JSONObject resources = JSON.parseObject(relatedResources);
            JSONArray files = resources == null ? null : resources.getJSONArray("files");
            if (files == null || files.isEmpty()) return null;
            List<GroupChatContextResponse.Attachment> result = new ArrayList<>();
            for (Object value : files) {
                if (!(value instanceof JSONObject file) || StringUtils.isBlank(file.getString("fileId"))
                    || StringUtils.isBlank(file.getString("fileName"))) continue;
                var attachment = new GroupChatContextResponse.Attachment();
                attachment.setFileId(file.getString("fileId"));
                attachment.setFileName(file.getString("fileName"));
                attachment.setFilePath(file.getString("filePath"));
                attachment.setFileUrl(file.getString("fileUrl"));
                // Forward descriptors use mediaType/size; ordinary uploads retain fileType compatibility.
                attachment.setMediaType(StringUtils.defaultIfBlank(file.getString("fileType"), file.getString("mediaType")));
                if (file.get("size") instanceof Number size && size.longValue() >= 0) attachment.setSize(size.longValue());
                result.add(attachment);
            }
            return result.isEmpty() ? null : result;
        }
        catch (Exception ignored) {
            return null;
        }
    }

    private Long parseRequiredLong(String value, String field) {
        if (StringUtils.isBlank(value)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is required");
        }
        try {
            return Long.valueOf(value.trim());
        }
        catch (NumberFormatException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is invalid");
        }
    }

    private Long parseOptionalLong(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return Long.valueOf(value);
        }
        catch (NumberFormatException exception) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.context.cursorInvalid"));
        }
    }

    private int bounded(Integer value, int defaultValue, int maximum) {
        if (value == null) {
            return defaultValue;
        }
        if (value <= 0 || value > maximum) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, I18nUtil.get("groupchat.window.invalid"));
        }
        return value;
    }
}
