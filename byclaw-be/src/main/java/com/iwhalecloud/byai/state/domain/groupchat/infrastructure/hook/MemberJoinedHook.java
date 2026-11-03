package com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook;

import com.iwhalecloud.byai.common.hook.HookEventSchema;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 普通工作组和租户工作组共用的真人用户入群通知。 */
@Configuration(proxyBeanMethods = false)
public class MemberJoinedHook {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(MemberJoinedHook.class);
    private final HookPublisher publisher;

    public MemberJoinedHook(HookPublisher publisher) {
        this.publisher = publisher;
    }

    @Bean
    public static HookEventSchema workgroupMemberJoinedHookSchema() {
        return new HookEventSchema("workgroup.member.joined", 1,
            Set.of("groupId", "enterpriseId", "userId", "invitedBy", "byaiSessionMemberId"));
    }

    /** 仅在成员表插入成功后调用，所有字段来自同一条持久化记录。 */
    public void memberSaved(com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember member) {
        memberJoined(member.getSessionId().toString(), member.getComAcctId(), member.getMemObjId().toString(),
            member.getCreatorId() == null ? null : member.getCreatorId().toString(),
            member.getByaiSessionMemberId() == null ? null : member.getByaiSessionMemberId().toString());
    }

    /** 仅用于实际新增的真人成员，由入群事务内调用。 */
    public void memberJoined(String groupId, Long enterpriseId, String userId, String invitedBy,
        String byaiSessionMemberId) {
        if (byaiSessionMemberId == null || !byaiSessionMemberId.matches("[1-9][0-9]*")) {
            LOG.info("用户添加触发勾子失败，成员主键无效,groupId={},enterpriseId={},userId={},byaiSessionMemberId={}", groupId, enterpriseId, userId, byaiSessionMemberId);
            throw new IllegalStateException("groupchat.member.id.unconfirmed");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("groupId", groupId);
        data.put("enterpriseId", enterpriseId == null ? null : enterpriseId.toString());
        data.put("userId", userId);
        data.put("invitedBy", invitedBy);
        data.put("byaiSessionMemberId", byaiSessionMemberId);
        publisher.publish("workgroup.member.joined", 1, data);
    }
}
