package com.iwhalecloud.byai.state.domain.chat.service;

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

import com.alibaba.fastjson.JSON;
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

    private final ByaiMessageMapper messageMapper;

    private final SessionService sessionService;

    private final SsResourceService resourceService;
    private final SessionMemberService memberService;
    private final GroupChatContextTokenService tokenService;

    @Autowired
    public GroupChatContextService(ByaiMessageMapper messageMapper, SessionService sessionService,
        SsResourceService resourceService, SessionMemberService memberService, GroupChatContextTokenService tokenService) {
        this.messageMapper = messageMapper;
        this.sessionService = sessionService;
        this.resourceService = resourceService;
        this.memberService = memberService;
        this.tokenService = tokenService;
    }

    /** 兼容既有单元测试和历史构造方式。 */
    public GroupChatContextService(ByaiMessageMapper messageMapper, SessionService sessionService,
        SsResourceService resourceService) {
        this(messageMapper, sessionService, resourceService, null, null);
    }

    public GroupChatContextResponse load(GroupChatContextRequest request) {
        Long sessionId = parseRequiredLong(request == null ? null : request.getConversationKey(), "conversationKey");
        Long beforeMessageId = parseOptionalLong(request == null ? null : request.getBeforeMessageId());
        if (beforeMessageId == null) {
            beforeMessageId = Objects.requireNonNullElse(messageMapper.selectLatestMessageId(sessionId), 0L) + 1;
        }
        requireGroupMember(sessionId, request);

        int maxMessages = bounded(request.getMaxMessages(), DEFAULT_MAX_MESSAGES, MAX_MESSAGES);
        int maxCharacters = bounded(request.getMaxCharacters(), DEFAULT_MAX_CHARACTERS, MAX_CHARACTERS);
        long totalCount = Objects.requireNonNullElse(
            messageMapper.countVisibleBeforeMessageId(sessionId, beforeMessageId), 0L);
        List<ByaiMessage> newestFirst = messageMapper.selectVisibleBeforeMessageId(sessionId, beforeMessageId,
            maxMessages);
        if (newestFirst == null) {
            newestFirst = Collections.emptyList();
        }
        List<ByaiMessage> ordered = new ArrayList<>(newestFirst);
        Collections.reverse(ordered);

        boolean characterTruncated = trimToCharacterLimit(ordered, maxCharacters);
        List<GroupChatContextResponse.Message> messages = toMessages(ordered);

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
        truncation.setTruncated(omitted > 0);
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
        String contextToken = request == null ? null : request.getContextToken();
        if (contextToken != null && tokenService != null) {
            Map<String, Object> claims = tokenService.verify(contextToken);
            if (request == null || request.getChildSessionId() == null || request.getInitiatorUserId() == null
                || request.getTargetAgentId() == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            if (!String.valueOf(sessionId).equals(String.valueOf(claims.get("groupSessionId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            if (request.getInitiatorUserId() != null
                && !String.valueOf(request.getInitiatorUserId()).equals(String.valueOf(claims.get("initiatorUserId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            if (request.getTargetAgentId() != null
                && !String.valueOf(request.getTargetAgentId()).equals(String.valueOf(claims.get("targetAgentId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            if (!String.valueOf(request.getChildSessionId()).equals(String.valueOf(claims.get("childSessionId")))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            Object boundary = claims.get("boundaryMessageId");
            Long requestedBefore = parseRequiredLong(request.getBeforeMessageId(), "beforeMessageId");
            if (boundary != null && requestedBefore > Long.parseLong(String.valueOf(boundary))) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
            }
            return;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        boolean member = memberService != null
            && memberService.findSessionMember(sessionId, MemObjType.USER.name(), currentUserId) != null;
        if (session == null || (memberService != null && !member)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found");
        }
    }

    private boolean trimToCharacterLimit(List<ByaiMessage> ordered, int maxCharacters) {
        int characters = ordered.stream()
            .map(ByaiMessage::getMessageContent)
            .filter(Objects::nonNull)
            .mapToInt(String::length)
            .sum();
        boolean truncated = false;
        while (!ordered.isEmpty() && characters > maxCharacters) {
            ByaiMessage removed = ordered.remove(0);
            characters -= StringUtils.defaultString(removed.getMessageContent()).length();
            truncated = true;
        }
        return truncated;
    }

    private List<GroupChatContextResponse.Message> toMessages(List<ByaiMessage> ordered) {
        List<GroupChatContextResponse.Message> result = new ArrayList<>(ordered.size());
        Map<Long, SsResource> resources = new HashMap<>();
        for (int index = 0; index < ordered.size(); index++) {
            ByaiMessage source = ordered.get(index);
            GroupChatContextResponse.Message message = new GroupChatContextResponse.Message();
            message.setMessageId(String.valueOf(source.getMessageId()));
            message.setSequence(index);
            message.setCreatedAt(source.getCreateTime() == null ? 0L : source.getCreateTime().getTime());
            message.setContent(StringUtils.defaultString(source.getMessageContent()));
            message.setTarget(toTarget(source));
            message.setRole(Integer.valueOf(1).equals(source.getUsage()) ? "user" : "assistant");
            message.setSpeaker(toSpeaker(source, resources));
            message.setAttachments(toAttachments(source.getRelatedResources()));
            if (source.getMessageRef() != null) {
                ByaiMessage referenced = messageMapper.selectByMessageId(source.getMessageRef());
                if (referenced != null && Objects.equals(source.getSessionId(), referenced.getSessionId())) {
                    GroupChatContextResponse.ReplyReference reply = new GroupChatContextResponse.ReplyReference();
                    reply.setMessageId(String.valueOf(referenced.getMessageId()));
                    reply.setContent(StringUtils.defaultString(referenced.getMessageContent()));
                    reply.setRole(Integer.valueOf(1).equals(referenced.getUsage()) ? "user" : "assistant");
                    reply.setSpeaker(toSpeaker(referenced, resources));
                    message.setReplyTo(reply);
                }
            }
            result.add(message);
        }
        return result;
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

    private GroupChatContextResponse.Speaker toSpeaker(ByaiMessage message, Map<Long, SsResource> resources) {
        GroupChatContextResponse.Speaker speaker = new GroupChatContextResponse.Speaker();
        if (Integer.valueOf(1).equals(message.getUsage())) {
            speaker.setType("user");
            speaker.setUserCode(resolveUserCode(message));
            if (StringUtils.isNotBlank(message.getCreatorName())) {
                speaker.setDisplayName(message.getCreatorName());
            }
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

    private List<GroupChatContextResponse.Attachment> toAttachments(String relatedResources) {
        if (StringUtils.isBlank(relatedResources)) {
            return null;
        }
        try {
            MessageResourceDto resources = JSON.parseObject(relatedResources, MessageResourceDto.class);
            if (resources == null || CollectionUtils.isEmpty(resources.getFiles())) {
                return null;
            }
            List<GroupChatContextResponse.Attachment> result = new ArrayList<>();
            for (MessageFileDto file : resources.getFiles()) {
                if (file == null || StringUtils.isBlank(file.getFileId()) || StringUtils.isBlank(file.getFileName())) {
                    continue;
                }
                GroupChatContextResponse.Attachment attachment = new GroupChatContextResponse.Attachment();
                attachment.setFileId(file.getFileId());
                attachment.setFileName(file.getFileName());
                if (StringUtils.isNotBlank(file.getFileType())) {
                    attachment.setMediaType(file.getFileType());
                }
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
            throw new IllegalArgumentException("Invalid beforeMessageId");
        }
    }

    private int bounded(Integer value, int defaultValue, int maximum) {
        if (value == null) {
            return defaultValue;
        }
        if (value <= 0 || value > maximum) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Requested group chat window is invalid");
        }
        return value;
    }
}
