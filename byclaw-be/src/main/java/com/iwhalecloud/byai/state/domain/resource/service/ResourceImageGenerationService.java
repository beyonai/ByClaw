package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.state.domain.resource.qo.GenerateResourceImageQo;
import com.iwhalecloud.byai.state.domain.resource.vo.GeneratedResourceImageVo;
import java.io.IOException;
import java.util.Base64;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 资源图片生成服务。
 *
 * @author qin.guoquan
 * @date 2026-06-21 20:38:38
 */
@Service
@Slf4j
public class ResourceImageGenerationService {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private static final String DEFAULT_MODEL_TYPE_LLM = "LLM";

    @Value("${resource.image-generation.connect-timeout-ms:30000}")
    private long connectTimeoutMs;

    @Value("${resource.image-generation.read-timeout-ms:120000}")
    private long readTimeoutMs;

    @Value("${resource.image-generation.size:1024x1024}")
    private String imageSize;

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    public GeneratedResourceImageVo generate(GenerateResourceImageQo request) {
        String resourceName = request == null ? null : request.getResourceName();
        String resourceDesc = request == null ? null : request.getResourceDesc();
        if (StringUtil.isEmpty(resourceName)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourcename.notnull"));
        }

        ByaiAimodel model = loadDefaultModel();
        String token = decryptTokenSafely(model.getAuthToken());
        if (StringUtil.isEmpty(token)) {
            throw new IllegalStateException(I18nUtil.get("resource.image.generate.model.not.configured"));
        }

        JSONObject body = new JSONObject(true);
        body.put("model", model.getModelNo());
        body.put("prompt", buildPrompt(resourceName, resourceDesc));
        body.put("n", 1);
        body.put("size", imageSize);

        Request.Builder builder = new Request.Builder().url(resolveImageGenerationsUrl(model.getUrl()))
            .post(RequestBody.create(body.toJSONString(), JSON_MEDIA_TYPE)).addHeader("Content-Type", "application/json")
            .addHeader("Authorization", "Bearer " + token);
        appendExtraHeaders(model, builder);

        OkHttpClient client = new OkHttpClient.Builder().connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS).build();
        try (Response response = client.newCall(builder.build()).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                log.warn("resource image generation failed, status={}, body={}", response.code(), responseBody);
                throw new IllegalStateException(I18nUtil.get("resource.image.generate.model.unsupported"));
            }
            return parseImageResponse(client, responseBody, resourceName);
        }
        catch (IOException e) {
            log.warn("resource image generation request failed", e);
            throw new IllegalStateException(I18nUtil.get("resource.image.generate.failed"));
        }
    }

    private ByaiAimodel loadDefaultModel() {
        String defaultModelId = modelManagementApplicationService.getDefaultModelId(DEFAULT_MODEL_TYPE_LLM);
        ByaiAimodel model = byaiAimodelDomainService.getById(Long.valueOf(defaultModelId));
        if (model == null || StringUtil.isEmpty(model.getUrl()) || StringUtil.isEmpty(model.getModelNo())) {
            throw new IllegalStateException(I18nUtil.get("resource.image.generate.model.not.configured"));
        }
        return model;
    }

    private GeneratedResourceImageVo parseImageResponse(OkHttpClient client, String responseBody, String resourceName)
        throws IOException {
        JSONObject json = JSONObject.parseObject(responseBody);
        JSONArray data = json == null ? null : json.getJSONArray("data");
        if (data == null || data.isEmpty()) {
            throw new IllegalStateException(I18nUtil.get("resource.image.generate.empty"));
        }
        JSONObject first = data.getJSONObject(0);
        String b64Json = first.getString("b64_json");
        if (StringUtil.isNotEmpty(b64Json)) {
            return new GeneratedResourceImageVo(stripDataUrlPrefix(b64Json), "image/png", buildFileName(resourceName));
        }
        String imageUrl = first.getString("url");
        if (StringUtil.isNotEmpty(imageUrl)) {
            return downloadImage(client, imageUrl, resourceName);
        }
        throw new IllegalStateException(I18nUtil.get("resource.image.generate.empty"));
    }

    private GeneratedResourceImageVo downloadImage(OkHttpClient client, String imageUrl, String resourceName)
        throws IOException {
        Request request = new Request.Builder().url(imageUrl).get().build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IllegalStateException(I18nUtil.get("resource.image.generate.empty"));
            }
            String contentType = response.body().contentType() == null ? "image/png"
                : response.body().contentType().toString();
            String imageBase64 = Base64.getEncoder().encodeToString(response.body().bytes());
            return new GeneratedResourceImageVo(imageBase64, contentType, buildFileName(resourceName));
        }
    }

    private String buildPrompt(String resourceName, String resourceDesc) {
        return """
            为一个企业级 AI 技能/资源生成一张高质量封面图。
            要求：
            1. 视觉风格：现代、专业、干净，有科技感，适合技能广场卡片展示。
            2. 画面主体要能体现资源能力，不要出现真实人物肖像、公司商标、二维码、水印。
            3. 不要在图片中放置大段文字，不要直接写资源名称，避免文字乱码。
            4. 构图适合卡片封面，中心主体清晰，背景有层次。

            资源名称：%s
            资源描述：%s
            """.formatted(resourceName, StringUtil.isEmpty(resourceDesc) ? resourceName : resourceDesc);
    }

    private void appendExtraHeaders(ByaiAimodel model, Request.Builder builder) {
        JSONObject inParams = parseInParams(model.getInParams());
        JSONArray headers = inParams.getJSONArray("headers");
        if (headers == null) {
            return;
        }
        for (int i = 0; i < headers.size(); i++) {
            JSONObject item = headers.getJSONObject(i);
            String key = item.getString("key");
            String value = item.getString("value");
            if (StringUtil.isEmpty(key) || StringUtil.isEmpty(value) || "authorization".equalsIgnoreCase(key.trim())) {
                continue;
            }
            builder.addHeader(key.trim(), value);
        }
    }

    private JSONObject parseInParams(String inParams) {
        if (StringUtil.isEmpty(inParams)) {
            return new JSONObject(true);
        }
        try {
            JSONObject json = JSONObject.parseObject(inParams);
            return json == null ? new JSONObject(true) : json;
        }
        catch (Exception e) {
            return new JSONObject(true);
        }
    }

    private String resolveImageGenerationsUrl(String baseUrl) {
        String url = baseUrl == null ? "" : baseUrl.trim();
        if (url.endsWith("/images/generations")) {
            return url;
        }
        url = url.replaceAll("/+$", "");
        return url + "/images/generations";
    }

    private String decryptTokenSafely(String encrypted) {
        if (StringUtil.isEmpty(encrypted)) {
            return "";
        }
        try {
            return Sm4Util.decrypt(encrypted);
        }
        catch (Exception e) {
            log.warn("resource image generation decrypt model token failed", e);
            return "";
        }
    }

    private String stripDataUrlPrefix(String value) {
        int commaIndex = value.indexOf(',');
        return value.startsWith("data:") && commaIndex > -1 ? value.substring(commaIndex + 1) : value;
    }

    private String buildFileName(String resourceName) {
        String safeName = resourceName == null ? "resource" : resourceName.replaceAll("[^a-zA-Z0-9._-]+", "-");
        if (safeName.isBlank()) {
            safeName = "resource";
        }
        return safeName + "-ai-cover.png";
    }
}
