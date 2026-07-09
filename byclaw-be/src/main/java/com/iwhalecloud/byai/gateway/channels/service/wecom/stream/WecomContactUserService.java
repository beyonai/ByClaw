package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@Service
public class WecomContactUserService {

    private final ObjectMapper objectMapper;
    private final WecomStreamProperties properties;
    private final WecomContactTokenService tokenService;

    public WecomContactUserService(ObjectMapper objectMapper,
                                   WecomStreamProperties properties,
                                   WecomContactTokenService tokenService) {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.tokenService = tokenService;
    }

    public WecomUserDetail getUserDetail(String botId, String userId) {
        if (!StringUtils.hasText(userId)) {
            return null;
        }

        String accessToken = tokenService.getAccessToken(botId);
        String url = properties.getContact().getUserGetUrl()
                + "?access_token=" + (accessToken)
                + "&userid=" + (userId);
        Request request = new Request.Builder().url(url).get().build();
        try (Response response = OkHttpUtil.getHttpClient().newCall(request).execute()) {
            String body = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IllegalStateException("Get WeCom user detail failed, httpCode=" + response.code());
            }
            JsonNode root = objectMapper.readTree(body);
            int errcode = root.path("errcode").asInt(-1);
            if (errcode != 0) {
                throw new IllegalStateException("Get WeCom user detail failed, errcode="
                        + errcode + ", errmsg=" + root.path("errmsg").asText(""));
            }

            WecomUserDetail detail = new WecomUserDetail();
            detail.setUserid(root.path("userid").asText(null));
            detail.setName(firstNonBlank(root.path("alias").asText(null), root.path("mobile").asText(null)));
            detail.setMobile(firstNonBlank(root.path("mobile").asText(null), root.path("telephone").asText(null)));
            detail.setEmail(firstNonBlank(root.path("email").asText(null), root.path("biz_mail").asText(null)));
            detail.setDepartment(readDepartment(root.path("department")));
            return detail;
        } catch (IOException e) {
            throw new IllegalStateException("Request WeCom user detail failed", e);
        }
    }

    private List<Long> readDepartment(JsonNode departmentNode) {
        if (!departmentNode.isArray()) {
            return null;
        }
        List<Long> department = new ArrayList<>();
        departmentNode.forEach(node -> {
            if (node.canConvertToLong()) {
                department.add(node.asLong());
            }
        });
        return department;
    }

    private String firstNonBlank(String first, String second) {
        return StringUtils.hasText(first) ? first : second;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
