package com.iwhalecloud.byai.state.infrastructure.agentconnect.handle;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import com.google.common.collect.Maps;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.BaseTokenFilter;
import com.iwhalecloud.byai.state.domain.agent.dto.AgentDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/17
 */
@Service
public class CommonHandler extends AgentTypeHandlerAbstract {

    @Autowired
    private BaseTokenFilter baseTokenFilter;

    @Autowired
    private JwtService jwtService;

    @Override
    public void handleHeader(AgentDto agentDto) {
        Map<String, Object> headers = Maps.newHashMap();
        RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();

         String accessType = CurrentUserHolder.getFilterType();
        if (requestAttributes instanceof ServletRequestAttributes servletRequestAttributes
            && !"URL-TOKEN".equalsIgnoreCase(accessType)) {
            HttpServletRequest request = servletRequestAttributes.getRequest();
            headers.put("sso-token", request.getHeader("Sso-Token"));
            headers.put("beyond-token", request.getHeader("Beyond-Token"));
            headers.put("cookie", request.getHeader("cookie"));
        }
        else {
            // 非 HTTP 场景，可以选择不设置 header，或设置默认值
            Map<String, String> paramMap =  CurrentUserHolder.getLoginInfo().getParamMap();
            headers.putAll(paramMap);
        }

        // 如果是钉钉sso认证获取从门户生成的token信息
        String sessionId = CurrentUserHolder.getSessionId();
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if ("SSO-TOKEN".equalsIgnoreCase(accessType) || "BEYOND-TOKEN".equalsIgnoreCase(accessType)) {
            headers.put("cookie", String.format("SESSION=%s; PORTAL-SESSION=%s", sessionId, sessionId));
        }
        else if ("URL-TOKEN".equalsIgnoreCase(accessType)) {
            headers.put("cookie", String.format("SESSION=%s; PORTAL-SESSION=%s", sessionId, sessionId));
            headers.put("sso-token", baseTokenFilter.createSsoToken(userCode));
        }

        headers.put("system-code", "BYAI");
        // 如果没有，自己产生百应beyond-token
        if (headers.get("beyond-token") == null) {
            headers.put("beyond-token", jwtService.createJwt(CurrentUserHolder.getLoginInfo()));
        }

        agentDto.setHeaders(headers);
    }

}
