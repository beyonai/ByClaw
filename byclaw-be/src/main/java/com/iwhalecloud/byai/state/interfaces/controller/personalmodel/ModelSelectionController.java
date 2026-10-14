package com.iwhalecloud.byai.state.interfaces.controller.personalmodel;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.chat.service.AutoModelRoutingService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.util.Map;
import java.util.Objects;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/personal/model")
public class ModelSelectionController {
    private final AutoModelRoutingService routing;
    private final StringRedisTemplate redis;
    private final SessionService sessions;
    private final SessionMemberService members;

    public ModelSelectionController(AutoModelRoutingService routing, StringRedisTemplate redis,
        SessionService sessions, SessionMemberService members) {
        this.routing = routing;
        this.redis = redis;
        this.sessions = sessions;
        this.members = members;
    }

    @GetMapping("/selectionCapabilities")
    public ResponseUtil<Map<String, Object>> capabilities() {
        return ResponseUtil.success(routing.capabilities());
    }

    @GetMapping("/selectionPreference")
    public ResponseUtil<Map> preference(@RequestParam Long sessionId) {
        if (com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.get() != null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Long userId = CurrentUserHolder.getCurrentUserId();
        var session = sessions.findById(sessionId);
        if (userId == null || session == null || (!Objects.equals(session.getCreatorId(), userId) &&
            members.findSessionMember(sessionId, "USER", userId) == null)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        String saved = redis.opsForValue().get("byai:chat:model_preference:" + userId + ":" + sessionId);
        return ResponseUtil.success(saved == null ? Map.of("mode", "default") : JSON.parseObject(saved, Map.class));
    }
}
