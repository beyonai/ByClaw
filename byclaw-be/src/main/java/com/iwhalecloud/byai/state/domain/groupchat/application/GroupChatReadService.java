package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;

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
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

/** 群列表未读 mention 查询与已读游标用例。 */
@Service
public class GroupChatReadService {
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ByaiSessionMemberMapper memberMapper;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatAuthorizationService authorizationService;
    private final MultiDeviceBroadcastService broadcastService;

    public GroupChatReadService(ByaiGroupChatMentionMapper mentionMapper, ByaiSessionMemberMapper memberMapper,
        ByaiMessageMapper messageMapper, GroupChatAuthorizationService authorizationService,
        MultiDeviceBroadcastService broadcastService) {
        this.mentionMapper = mentionMapper;
        this.memberMapper = memberMapper;
        this.messageMapper = messageMapper;
        this.authorizationService = authorizationService;
        this.broadcastService = broadcastService;
    }

    @Transactional(readOnly = true)
    public PageInfo<GroupChatListItemResponse> listMyGroups(Integer pageNum, Integer pageSize) {
        int normalizedPageNum = pageNum == null || pageNum < 1 ? 1 : pageNum;
        int normalizedPageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
        Page<GroupChatListItemResponse> page = PageHelper.startPage(normalizedPageNum, normalizedPageSize);
        mentionMapper.selectMyGroups(CurrentUserHolder.getCurrentUserId());
        return PageHelperUtil.toPageInfo(page);
    }

    @Transactional
    public GroupChatReadStateResponse markRead(Long sessionId, Long messageId) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        authorizationService.requireGroup(sessionId);
        ByaiSessionMember member = authorizationService.requireCurrentUserMember(sessionId);
        ByaiMessage message = messageMapper.selectByMessageId(messageId);
        if (message == null || !sessionId.equals(message.getSessionId())) {
            throw new IllegalArgumentException("Read cursor message is not in this group");
        }
        memberMapper.advanceReadCursor(member.getByaiSessionMemberId(), messageId, new Date());
        GroupChatListItemResponse state = mentionMapper.selectMentionState(sessionId, currentUserId);
        GroupChatReadStateResponse response = new GroupChatReadStateResponse();
        response.setSessionId(sessionId);
        response.setLastReadMessageId(state == null ? member.getLastReadMessageId() : state.getLastReadMessageId());
        response.setUnreadMentionCount(state == null ? 0 : state.getUnreadMentionCount());
        response.setLatestMentionMessageId(state == null ? null : state.getLatestMentionMessageId());
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publishReadState(currentUserId, response);
                }
            });
        }
        else {
            publishReadState(currentUserId, response);
        }
        return response;
    }

    private void publishReadState(Long userId, GroupChatReadStateResponse response) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "READ_STATE_UPDATED");
        event.put("sessionId", String.valueOf(response.getSessionId()));
        event.put("lastReadMessageId", response.getLastReadMessageId() == null
            ? null : String.valueOf(response.getLastReadMessageId()));
        event.put("unreadMentionCount", response.getUnreadMentionCount());
        event.put("hasUnreadMention", response.isHasUnreadMention());
        event.put("latestMentionMessageId", response.getLatestMentionMessageId() == null
            ? null : String.valueOf(response.getLatestMentionMessageId()));
        broadcastService.broadcastRawToUser(userId, event, null);
    }
}
