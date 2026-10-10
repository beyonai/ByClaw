package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Resolve task member engines through the same user policy as ordinary chat. */
@Service
@RequiredArgsConstructor
public class GroupChatMemberRoutingService {
    private final SsResourceService resources;
    private final TargetAgentResolver routes;

    public Map<String, Object> withRoutes(Map<?, ?> scope, String userCode) {
        if (userCode == null || userCode.isBlank()) throw new BaseException("Group member routing requires the initiating user");
        Map<String, String> effective = new LinkedHashMap<>();
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>();
        ids.add(String.valueOf(scope.get("coordinatorAgentId")));
        for (Object id : (List<?>) scope.get("allowedAgentIds")) ids.add(String.valueOf(id));
        for (String id : ids) {
            var employee = resources.findById(Long.valueOf(id));
            if (employee == null) throw new BaseException("Group employee is unavailable: " + id);
            String target = routes.resolveAgentType(employee.getWorkerAgentType(), Long.valueOf(id), null, userCode);
            if (target == null || target.isBlank()) throw new BaseException("Group employee has no execution route: " + id);
            effective.put(id, target);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        scope.forEach((key, value) -> result.put(String.valueOf(key), value));
        result.put("effectiveWorkerAgentTypes", effective);
        return result;
    }
}
