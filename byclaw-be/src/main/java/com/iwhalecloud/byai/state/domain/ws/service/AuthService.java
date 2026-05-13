package com.iwhalecloud.byai.state.domain.ws.service;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.BaseTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.utils.CloseUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import io.jsonwebtoken.ExpiredJwtException;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpHeaders;
import lombok.extern.slf4j.Slf4j;

@Component
@Slf4j
public class AuthService {

    @Autowired
    private JwtService jwtService;

    @Autowired
    private ChannelManager channelManager;

    @Autowired
    private BaseTokenFilter baseTokenFilter;

    public void auth(ChannelHandlerContext ctx, FullHttpRequest request) {
        try {
            String jwtToken = null;

            // 首先从 header 中获取 token
            jwtToken = request.headers().get("beyond-token");

            // 如果 header 中没有，则从请求参数中获取
            if (StringUtils.isBlank(jwtToken)) {
                String uri = request.uri();
                if (uri.contains("beyond-token=")) {
                    jwtToken = uri.substring(uri.indexOf("beyond-token=") + "beyond-token=".length());
                    // 如果有其他参数，需要截取到 & 之前
                    int andIndex = jwtToken.indexOf('&');
                    if (andIndex != -1) {
                        jwtToken = jwtToken.substring(0, andIndex);
                    }
                }
                // header补充beyond-token
                if (StringUtils.isNotBlank(jwtToken)) {
                    request.headers().add("beyond-token", jwtToken);
                }

                Map<String, String> urlParamMap = parseUrl(uri);
                if (MapUtils.isNotEmpty(urlParamMap)) {
                    log.info("ws urlParamMap: {}", JSON.toJSONString(urlParamMap));
                    for (Map.Entry<String, String> entry : urlParamMap.entrySet()) {
                        String key = entry.getKey();
                        String value = entry.getValue();
                        request.headers().add(key, value);
                    }
                }
            }

            // 如果都没有找到 token，抛出异常
            if (jwtToken == null || jwtToken.isEmpty()) {
                throw new RuntimeException(I18nUtil.get("ws.auth.beyond.token.not.found"));
            }

            HttpHeaders headers = request.headers();
            LoginInfo loginInfo = jwtService.verifyJwt(jwtToken, LoginInfo.class);
            if (loginInfo == null) {
                throw new RuntimeException(I18nUtil.get("ws.auth.signature.null"));
            }
            Iterator<Map.Entry<String, String>> entryIterator = headers.iteratorAsString();
            Map<String, String> map = new HashMap<>();
            while (entryIterator.hasNext()) {
                Map.Entry<String, String> next = entryIterator.next();
                map.put(next.getKey(), next.getValue());
            }
            // 设置用户属性
            loginInfo.setParamMap(map);
            ctx.channel().attr(Constant.ATT_USER_INFO).set(loginInfo);
            ctx.channel().attr(Constant.ATT_HEADER).set(map);
            channelManager.addChannel(loginInfo.getUserId(), ctx.channel());
            log.info("WebSocket handshake completed for user {}", loginInfo);

            // 补充后端生成的sso-token给bot使用
            request.headers().add("sso-token", baseTokenFilter.createSsoToken(loginInfo.getUserCode()));
        } catch (ExpiredJwtException e) {
            // 转换异常，指定code，让前端知道时token过期，去调刷新token接口
            CloseUtil.close(ctx);
            throw new RuntimeException(I18nUtil.get("ws.auth.token.expiration"), e);
        } catch (Exception e) {
            log.error("Error during WebSocket handshake", e);
            CloseUtil.close(ctx);
            throw new RuntimeException(e.getMessage(), e);
        }
    }


    public static Map<String, String> parseUrl(String url) {
        Map<String, String> params = new HashMap<>(4);
        try {
            String[] parts = url.split("\\?");
            if (parts.length > 1) {
                String query = parts[1];
                String[] pairs = query.split("&");
                for (String pair : pairs) {
                    int idx = pair.indexOf("=");
                    String key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8.name());
                    String value = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8.name());
                    params.put(key, value);
                }
            }
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
        return params;
    }
}
