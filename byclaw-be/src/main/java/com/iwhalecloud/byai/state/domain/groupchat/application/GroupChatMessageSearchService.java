package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchResponse;

/** 工作组公开聊天记录的检索和消息定位。 */
@Service
public class GroupChatMessageSearchService {
    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;
    private static final int CONTEXT_SIDE_SIZE = 25;

    private final ByaiMessageMapper messageMapper;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatContextService contextService;

    public GroupChatMessageSearchService(ByaiMessageMapper messageMapper,
        GroupChatAuthorizationService authorization, GroupChatContextService contextService) {
        this.messageMapper = messageMapper;
        this.authorization = authorization;
        this.contextService = contextService;
    }

    public GroupChatMessageSearchResponse search(Long sessionId, GroupChatMessageSearchRequest request) {
        authorization.requireCurrentUserMember(sessionId);
        GroupChatMessageSearchRequest input = request == null ? new GroupChatMessageSearchRequest() : request;
        String keyword = StringUtils.trimToNull(input.getKeyword());
        if (keyword != null && keyword.length() > 100) {
            throw new IllegalArgumentException("Keyword must not exceed 100 characters");
        }
        String scope = normalize(input.getScope(), "ALL", List.of("ALL", "MINE", "MENTIONED_ME"));
        String senderType = normalize(input.getSenderType(), "ALL", List.of("ALL", "USER", "AGENT"));
        Long beforeMessageId = parseOptionalId(input.getBeforeMessageId());
        int limit = input.getLimit() == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, input.getLimit()));
        Date startTime = input.getStartTime() == null ? null : new Date(input.getStartTime());
        Date endTime = input.getEndTime() == null ? null : new Date(input.getEndTime());
        if (startTime != null && endTime != null && startTime.after(endTime)) {
            throw new IllegalArgumentException("startTime must not be after endTime");
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        List<ByaiMessage> rows = messageMapper.searchVisibleGroupMessages(sessionId, escapeLike(keyword), scope,
            senderType, userId, startTime, endTime, beforeMessageId, limit + 1);
        if (rows == null) rows = Collections.emptyList();
        boolean hasMore = rows.size() > limit;
        List<ByaiMessage> page = new ArrayList<>(rows.subList(0, Math.min(limit, rows.size())));
        GroupChatMessageSearchResponse response = new GroupChatMessageSearchResponse();
        response.setMessages(contextService.toMessages(page));
        response.setHasMore(hasMore);
        if (hasMore && !page.isEmpty()) response.setNextBeforeMessageId(String.valueOf(page.get(page.size() - 1).getMessageId()));
        return response;
    }

    public GroupChatContextResponse around(Long sessionId, Long messageId) {
        authorization.requireCurrentUserMember(sessionId);
        ByaiMessage target = messageMapper.selectVisibleGroupMessage(sessionId, messageId);
        if (target == null) throw new IllegalArgumentException("Group message not found");
        List<ByaiMessage> before = messageMapper.selectVisibleBeforeMessageId(sessionId, messageId + 1, CONTEXT_SIDE_SIZE + 2);
        List<ByaiMessage> after = messageMapper.selectVisibleAfterMessageId(sessionId, messageId, CONTEXT_SIDE_SIZE);
        List<ByaiMessage> ordered = new ArrayList<>();
        boolean hasOlder = before != null && before.size() > CONTEXT_SIDE_SIZE + 1;
        if (before != null) {
            List<ByaiMessage> chronological = new ArrayList<>(before.subList(0,
                Math.min(CONTEXT_SIDE_SIZE + 1, before.size())));
            Collections.reverse(chronological);
            ordered.addAll(chronological);
        }
        if (after != null) ordered.addAll(after);
        GroupChatContextResponse response = new GroupChatContextResponse();
        response.setConversationKey(String.valueOf(sessionId));
        response.setMessages(contextService.toMessages(ordered));
        GroupChatContextResponse.Truncation truncation = new GroupChatContextResponse.Truncation();
        truncation.setTruncated(hasOlder);
        truncation.setOmittedMessageCount(hasOlder ? 1 : 0);
        truncation.setReason(hasOlder ? "message_limit" : null);
        response.setTruncation(truncation);
        return response;
    }

    private String normalize(String value, String fallback, List<String> allowed) {
        String normalized = StringUtils.defaultIfBlank(value, fallback).toUpperCase();
        if (!allowed.contains(normalized)) throw new IllegalArgumentException("Invalid search filter");
        return normalized;
    }

    private Long parseOptionalId(String value) {
        if (StringUtils.isBlank(value)) return null;
        try {
            return Long.valueOf(value);
        }
        catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Invalid message cursor");
        }
    }

    private String escapeLike(String value) {
        return value == null ? null : value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
