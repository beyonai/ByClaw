package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Objects;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenResponse;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import lombok.Data;
import lombok.RequiredArgsConstructor;

/** 邀请凭证由服务器签发；Redis 仅以 SHA-256 摘要索引，丢失记录时拒绝访问。 */
@Service
@RequiredArgsConstructor
public class GroupChatInvitationService {
    private static final Duration VALIDITY = Duration.ofDays(7);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private final StringRedisTemplate redis;
    private final SessionExtService extensions;
    private final SessionMemberService members;
    private final GroupChatAuthorizationService authorization;
    private final UserService users;
    private final EnterpriseInfoMapper enterprises;
    private final com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService resources;

    public GroupChatInvitationTokenResponse create(Long sessionId) {
        Long userId = requireUser();
        ByaiSession group = authorization.requireGroup(sessionId);
        authorization.requireAdmin(sessionId);
        requireLinkEnabled(sessionId);
        requireEnterprise(group);
        requireInviter(sessionId, userId);
        InvitationRecord record = new InvitationRecord();
        record.setSessionId(sessionId);
        record.setInviterId(userId);
        record.setEnterpriseId(group.getEnterpriseId());
        record.setExpiresAt(System.currentTimeMillis() + VALIDITY.toMillis());
        for (int attempt = 0; attempt < 3; attempt++) {
            StringBuilder tokenBuilder = new StringBuilder(8);
            for (int i = 0; i < 8; i++) {
                tokenBuilder.append(TOKEN_ALPHABET.charAt(RANDOM.nextInt(TOKEN_ALPHABET.length())));
            }
            String token = tokenBuilder.toString();
            if (Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key(token), JSON.toJSONString(record), VALIDITY))) {
                GroupChatInvitationTokenResponse response = new GroupChatInvitationTokenResponse();
                response.setToken(token);
                response.setExpiresAt(record.getExpiresAt());
                return response;
            }
        }
        throw new IllegalStateException("Unable to create invitation");
    }

    public GroupChatInvitationResponse preview(String token) {
        InvitationRecord record = read(token);
        ByaiSession group = validate(record);
        Users inviter = requireInviter(record.getSessionId(), record.getInviterId());
        GroupChatInvitationResponse response = new GroupChatInvitationResponse();
        response.setGroupNumber(String.valueOf(group.getSessionId()));
        response.setGroupName(group.getSessionName());
        response.setInviterName(inviter.getUserName());
        if (group.getEnterpriseId() != null) {
            var enterprise = enterprises.selectById(group.getEnterpriseId());
            if (enterprise != null) response.setEnterpriseName(enterprise.getComAcctName());
        }
        var groupMembers = members.findOrderedGroupMembers(group.getSessionId());
        response.setMemberCount(groupMembers.size());
        response.setMemberPreviews(groupMembers.stream().limit(4).map(this::memberPreview).toList());
        response.setExpiresAt(record.getExpiresAt());
        response.setAllowJoinByLink(true);
        Long userId = CurrentUserHolder.getCurrentUserId();
        response.setAlreadyMember(userId != null && userId > 0
            && members.findSessionMember(group.getSessionId(), "USER", userId) != null);
        return response;
    }

    /** 只解析服务端绑定群；写入前由 applicationService 在群锁内重新校验。 */
    public Long resolveSessionId(String token) {
        requireUser();
        return read(token).getSessionId();
    }

    public ByaiSession validateForMemberInvitation(Long sessionId, String token) {
        requireUser();
        InvitationRecord record = read(token);
        if (!Objects.equals(sessionId, record.getSessionId())) throw invalid();
        ByaiSession group = validate(record);
        requireEnterprise(group);
        if (users.findById(requireUser()) == null) throw invalid();
        return group;
    }

    private GroupChatInvitationResponse.MemberPreview memberPreview(ByaiSessionMember member) {
        var preview = new GroupChatInvitationResponse.MemberPreview();
        preview.setType(member.getMemObjType());
        preview.setDisplayName(member.getMemName());
        if ("AGENT".equals(member.getMemObjType())) {
            var agent = resources.findById(member.getMemObjId());
            if (agent != null) {
                preview.setDisplayName(agent.getResourceName());
                preview.setAvatar(agent.getAvatar());
            }
        } else if (preview.getDisplayName() == null || preview.getDisplayName().isBlank()) {
            var user = users.findById(member.getMemObjId());
            if (user != null) preview.setDisplayName(user.getUserName());
        }
        return preview;
    }

    private InvitationRecord read(String token) {
        if (token == null || !token.matches("[A-Za-z0-9]{8}")) throw invalid();
        String value = redis.opsForValue().get(key(token));
        if (value == null) throw invalid();
        InvitationRecord record = JSON.parseObject(value, InvitationRecord.class);
        if (record == null || record.getSessionId() == null || record.getInviterId() == null) throw invalid();
        return record;
    }

    private ByaiSession validate(InvitationRecord record) {
        if (record.getExpiresAt() <= System.currentTimeMillis()) throw invalid();
        ByaiSession group = authorization.requireGroup(record.getSessionId());
        if (!Objects.equals(group.getEnterpriseId(), record.getEnterpriseId())) throw invalid();
        requireLinkEnabled(group.getSessionId());
        requireInviter(group.getSessionId(), record.getInviterId());
        return group;
    }

    private Users requireInviter(Long sessionId, Long userId) {
        ByaiSessionMember inviter = authorization.requireUserMember(sessionId, userId);
        if (!"OWNER".equals(inviter.getUserRole()) && !"ADMIN".equals(inviter.getUserRole())) throw invalid();
        Users user = users.findById(userId);
        if (user == null || !"A".equals(user.getState()) || "Y".equals(user.getIsLocked())
            || (user.getUserExpDate() != null && user.getUserExpDate().getTime() <= System.currentTimeMillis())) {
            throw invalid();
        }
        return user;
    }

    private void requireLinkEnabled(Long sessionId) {
        ByaiSessionExt ext = extensions.findOneByExtParamCode(sessionId, "group_join_link_enabled");
        if (ext != null && !"true".equals(ext.getExtParamValue())) throw invalid();
    }

    private void requireEnterprise(ByaiSession group) {
        if (group.getEnterpriseId() != null
            && !Objects.equals(group.getEnterpriseId(), CurrentUserHolder.getEnterpriseId())) {
            throw new IllegalArgumentException("Only users in the group's enterprise can join");
        }
    }

    private Long requireUser() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) throw new IllegalArgumentException("Login required");
        return userId;
    }

    private String key(String token) {
        try {
            return "group-chat:invitation:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private IllegalArgumentException invalid() {
        return new IllegalArgumentException("Invitation is invalid or expired");
    }

    @Data
    public static class InvitationRecord {
        private Long sessionId;
        private Long inviterId;
        private Long enterpriseId;
        private long expiresAt;
    }
}
