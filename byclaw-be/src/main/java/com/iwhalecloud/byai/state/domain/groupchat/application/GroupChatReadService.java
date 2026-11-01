package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSONObject;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessagePreview;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatRecallProjection;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberSummary;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

/** 群列表未读消息、未读 mention 查询与已读游标用例。 */
@Service
public class GroupChatReadService {
    private static final int GROUP_AVATAR_MEMBER_LIMIT = 9;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ByaiSessionMemberMapper memberMapper;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatAuthorizationService authorizationService;
    private final MultiDeviceBroadcastService broadcastService;
    private final GroupChatContextService contextService;

    public GroupChatReadService(ByaiGroupChatMentionMapper mentionMapper, ByaiSessionMemberMapper memberMapper,
        ByaiMessageMapper messageMapper, GroupChatAuthorizationService authorizationService,
        MultiDeviceBroadcastService broadcastService, GroupChatContextService contextService) {
        this.mentionMapper = mentionMapper;
        this.memberMapper = memberMapper;
        this.messageMapper = messageMapper;
        this.authorizationService = authorizationService;
        this.broadcastService = broadcastService;
        this.contextService = contextService;
    }

    @Transactional(readOnly = true)
    public PageInfo<GroupChatListItemResponse> listMyGroups(Integer pageNum, Integer pageSize) {
        return listMyGroupsInEnterprise(pageNum, pageSize == null ? null : Math.min(pageSize, 100), null);
    }

    @Transactional(readOnly = true)
    public PageInfo<GroupChatListItemResponse> listMyGroups(Integer pageNum, Integer pageSize, Long enterpriseId) {
        return listMyGroupsInEnterprise(pageNum, pageSize == null ? null : Math.min(pageSize, 100), enterpriseId);
    }

    @Transactional(readOnly = true)
    public PageInfo<GroupChatListItemResponse> listMyGroupsInEnterprise(Integer pageNum, Integer pageSize,
        Long enterpriseId) {
        return listMyGroupsInEnterprise(CurrentUserHolder.getCurrentUserId(), pageNum, pageSize, enterpriseId);
    }

    /** 聚合查询在线程池中执行时显式传入用户，避免依赖 ThreadLocal 登录上下文。 */
    @Transactional(readOnly = true)
    public PageInfo<GroupChatListItemResponse> listMyGroupsInEnterprise(Long userId, Integer pageNum,
        Integer pageSize, Long enterpriseId) {
        int normalizedPageNum = pageNum == null || pageNum < 1 ? 1 : pageNum;
        int normalizedPageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 1000);
        Page<GroupChatListItemResponse> page = PageHelper.startPage(normalizedPageNum, normalizedPageSize);
        List<GroupChatListItemResponse> groups = mentionMapper.selectMyGroups(userId, enterpriseId);
        List<Long> sessionIds = groups.stream().map(GroupChatListItemResponse::getSessionId).toList();
        Map<Long, List<GroupChatMemberSummary>> membersBySession = sessionIds.isEmpty()
            ? Collections.emptyMap()
            : Optional.ofNullable(memberMapper.findGroupMemberSummaries(sessionIds, GROUP_AVATAR_MEMBER_LIMIT))
                .orElseGet(List::of).stream()
                .collect(Collectors.groupingBy(GroupChatMemberSummary::getSessionId));
        // 只投影本页每个群的最后一条未撤回消息，不触发逐条消息查询。
        List<ByaiMessage> latestMessages = groups.stream()
            .filter(group -> group.getLatestMessageId() != null && !group.isLatestMessageRecalled())
            .map(group -> {
                ByaiMessage message = new ByaiMessage();
                message.setMessageId(group.getLatestMessageId());
                message.setSessionId(group.getSessionId());
                message.setMetadata(group.getLatestMessageMetadata());
                message.setRelatedResources(group.getLatestMessageRelatedResources());
                return message;
            }).toList();
        var attachmentsByMessage = contextService.attachmentsForMessages(latestMessages);
        GroupChatRecallProjection projection = new GroupChatRecallProjection();
        for (GroupChatListItemResponse group : groups) {
            group.setMembers(membersBySession.getOrDefault(group.getSessionId(), List.of()));
            group.setLatestMessageAttachments(attachmentsByMessage.getOrDefault(group.getLatestMessageId(), List.of()));
            if (group.isLatestMessageRecalled()) {
                group.setLatestMessageContent(projection.content(group.getLatestMessageRecalledBy()));
                group.setLatestMessageMetadata(null);
                continue;
            }
            group.setLatestMessageContent(GroupChatMessagePreview.fromMetadata(
                group.getLatestMessageContent(), group.getLatestMessageMetadata()));
        }
        return PageHelperUtil.toPageInfo(page);
    }

    @Transactional
    public GroupChatReadStateResponse markRead(Long sessionId, Long messageId) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        authorizationService.requireGroup(sessionId);
        ByaiSessionMember member = authorizationService.requireCurrentUserMember(sessionId);
        ByaiMessage message = messageMapper.selectByMessageId(messageId);
        if (message == null || !sessionId.equals(message.getSessionId())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.read.cursorMismatch"));
        }
        // 复用成员表的单调递增已读位置；只有实际前进时才通知其他成员刷新回执。
        int advanced = memberMapper.advanceReadCursor(member.getByaiSessionMemberId(), messageId, new Date());
        GroupChatListItemResponse state = mentionMapper.selectMentionState(sessionId, currentUserId);
        GroupChatReadStateResponse response = new GroupChatReadStateResponse();
        response.setSessionId(sessionId);
        response.setLastReadMessageId(state == null ? member.getLastReadMessageId() : state.getLastReadMessageId());
        response.setUnreadCount(state == null ? 0 : state.getUnreadCount());
        response.setUnreadMentionCount(state == null ? 0 : state.getUnreadMentionCount());
        response.setLatestMentionMessageId(state == null ? null : state.getLatestMentionMessageId());
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publishReadState(currentUserId, response);
                    if (advanced > 0) {
                        publishReceiptChange(sessionId, currentUserId, response.getLastReadMessageId());
                    }
                }
            });
        }
        else {
            publishReadState(currentUserId, response);
            if (advanced > 0) {
                publishReceiptChange(sessionId, currentUserId, response.getLastReadMessageId());
            }
        }
        return response;
    }

    /**
     * 在已读位置提交后通知有效真人成员，由客户端按成员已读位置计算消息回执。
     * 此事件与仅发送给阅读者本人的个人未读计数事件分离，不保存逐消息已读记录。
     *
     * @param sessionId 群会话 ID
     * @param userId 本次更新已读位置的成员 ID
     * @param lastReadMessageId 数据库实际保存的已读消息 ID
     */
    private void publishReceiptChange(Long sessionId, Long userId, Long lastReadMessageId) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "READ_RECEIPTS_UPDATED");
        event.put("sessionId", sessionId.toString());
        event.put("userId", userId.toString());
        event.put("lastReadMessageId", lastReadMessageId == null ? null : lastReadMessageId.toString());
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        for (ByaiSessionMember recipient : memberMapper.findOrderedGroupMembers(sessionId)) {
            if (!"USER".equals(recipient.getMemObjType()) || "00X".equals(recipient.getState())) {
                continue;
            }
            // 广播按 WebSocket 的企业上下文隔离，而非按数据存储位置区分。
            // 企业 1 和试用租户虽共享数据，携带企业上下文时仍须走租户广播。
            if (tenant == null) {
                broadcastService.broadcastRawToUser(recipient.getMemObjId(), event, null);
            } else {
                broadcastService.broadcastTenantRawToUser(new TenantRequestContext(
                    recipient.getMemObjId(), tenant.enterpriseId(), tenant.role()), event, null);
            }
        }
    }

    private void publishReadState(Long userId, GroupChatReadStateResponse response) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "READ_STATE_UPDATED");
        event.put("sessionId", String.valueOf(response.getSessionId()));
        event.put("lastReadMessageId", response.getLastReadMessageId() == null
            ? null : String.valueOf(response.getLastReadMessageId()));
        event.put("unreadCount", response.getUnreadCount());
        event.put("unreadMentionCount", response.getUnreadMentionCount());
        event.put("hasUnreadMention", response.isHasUnreadMention());
        event.put("latestMentionMessageId", response.getLatestMentionMessageId() == null
            ? null : String.valueOf(response.getLatestMentionMessageId()));
        broadcastService.broadcastRawToUser(userId, event, null);
    }
}
