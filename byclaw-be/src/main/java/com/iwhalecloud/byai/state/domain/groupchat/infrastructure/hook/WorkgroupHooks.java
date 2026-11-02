package com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook;

import com.iwhalecloud.byai.common.hook.HookEventSchema;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 普通工作组和租户工作组共用对外事件协议，groupId 即群聊 sessionId。 */
@Configuration(proxyBeanMethods = false)
public class WorkgroupHooks {
    private final HookPublisher publisher;

    public WorkgroupHooks(HookPublisher publisher) {
        this.publisher = publisher;
    }

    @Bean
    public static HookEventSchema workgroupCreatedHookSchema() {
        return new HookEventSchema("workgroup.created", 1,
            Set.of("groupId", "groupName", "enterpriseId", "projectId", "createdBy"));
    }

    /** 由创建事务内调用，保存白名单快照；个人工作组的 enterpriseId 可以为空。 */
    public void created(String groupId, String groupName, Long enterpriseId, Long projectId, Long createdBy) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("groupId", groupId);
        data.put("groupName", groupName);
        data.put("enterpriseId", enterpriseId == null ? null : enterpriseId.toString());
        data.put("projectId", projectId.toString());
        data.put("createdBy", createdBy.toString());
        publisher.publish("workgroup.created", 1, data);
    }
}
