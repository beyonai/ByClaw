package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMessageFileDownloadResult;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Service
public class DingtalkFileDownloadService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkFileDownloadService.class);
    private static final String MESSAGE_FILE_DOWNLOAD_URL = "https://api.dingtalk.com/v1.0/robot/messageFiles/download";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private final ObjectMapper objectMapper;
    private final OkHttpClient okHttpClient = new OkHttpClient();

    public DingtalkFileDownloadService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DingtalkMessageFileDownloadResult downloadMessageFile(String accessToken, String downloadCode,
                                                                 String robotCode, String fileName) {
        if (!StringUtils.hasText(accessToken)) {
            throw new IllegalStateException("DingTalk accessToken is empty");
        }
        if (!StringUtils.hasText(downloadCode)) {
            throw new IllegalStateException("DingTalk downloadCode is empty");
        }
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalStateException("DingTalk robotCode is empty");
        }

        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("downloadCode", downloadCode);
            requestBody.put("robotCode", robotCode);

            Request request = new Request.Builder()
                    .url(MESSAGE_FILE_DOWNLOAD_URL)
                    .addHeader("x-acs-dingtalk-access-token", accessToken)
                    .addHeader("Content-Type", "application/json")
                    .post(RequestBody.create(objectMapper.writeValueAsString(requestBody), JSON_MEDIA_TYPE))
                    .build();

            try (Response response = okHttpClient.newCall(request).execute()) {
                String responseBody = readResponseBody(response);
                if (!response.isSuccessful()) {
                    throw new IllegalStateException("Download DingTalk message file failed, httpCode="
                            + response.code() + ", body=" + responseBody);
                }

                JsonNode root = objectMapper.readTree(responseBody);
                if (root.has("code") && root.get("code").asInt(0) != 0) {
                    throw new IllegalStateException("Download DingTalk message file failed, code="
                            + root.path("code").asText() + ", message=" + root.path("message").asText());
                }

                JsonNode resultNode = root.has("result") ? root.get("result") : root;
                DingtalkMessageFileDownloadResult result = new DingtalkMessageFileDownloadResult();
                result.setDownloadUrl(getText(resultNode, "downloadUrl"));
                result.setFileName(getText(
                    resultNode,
                    "fileName",
                    StringUtils.hasText(fileName) ? fileName : "dingtalk_" + robotCode + "_" + System.currentTimeMillis()
                ));
                result.setContentType(getText(resultNode, "contentType", "application/octet-stream"));
                if (!StringUtils.hasText(result.getDownloadUrl())) {
                    throw new IllegalStateException("Download DingTalk message file failed, downloadUrl is empty");
                }
                return result;
            }
        } catch (IOException e) {
            throw new IllegalStateException("Request DingTalk message file download failed", e);
        }
    }

    public byte[] downloadMessageFileBinary(DingtalkMessageFileDownloadResult downloadResult) {
        if (downloadResult == null || !StringUtils.hasText(downloadResult.getDownloadUrl())) {
            throw new IllegalStateException("DingTalk downloadUrl is empty");
        }

        Request request = new Request.Builder()
                .url(downloadResult.getDownloadUrl())
                .get()
                .build();
        try (Response response = okHttpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IllegalStateException("Download DingTalk file binary failed, httpCode=" + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new IllegalStateException("Download DingTalk file binary failed, empty body");
            }
            byte[] bytes = body.bytes();

            if (!StringUtils.hasText(downloadResult.getContentType())) {
                String responseContentType = response.header("Content-Type");
                if (StringUtils.hasText(responseContentType)) {
                    downloadResult.setContentType(responseContentType);
                }
            }
            if (downloadResult.getFileSize() == null) {
                downloadResult.setFileSize((long) bytes.length);
            }
            if (!StringUtils.hasText(downloadResult.getFileName())) {
                String resolvedName = resolveFileName(response, downloadResult.getDownloadUrl());
                if (StringUtils.hasText(resolvedName)) {
                    downloadResult.setFileName(resolvedName);
                }
            }
            return bytes;
        } catch (IOException e) {
            throw new IllegalStateException("Download DingTalk file binary failed", e);
        }
    }

    private String readResponseBody(Response response) throws IOException {
        ResponseBody responseBody = response.body();
        return responseBody == null ? "" : responseBody.string();
    }

    private String resolveFileName(Response response, String downloadUrl) {
        String disposition = response.header("Content-Disposition");
        if (StringUtils.hasText(disposition)) {
            String fileNameStar = matchGroup(disposition, "filename\\*\\s*=\\s*(?:UTF-8''|\"?)([^\";]+)\"?");
            if (StringUtils.hasText(fileNameStar)) {
                return java.net.URLDecoder.decode(fileNameStar, java.nio.charset.StandardCharsets.UTF_8);
            }
            String fn = matchGroup(disposition, "filename\\s*=\\s*\"?([^\";]+)\"?");
            if (StringUtils.hasText(fn)) {
                return fn;
            }
        }
        try {
            String path = java.net.URI.create(downloadUrl).getPath();
            if (StringUtils.hasText(path)) {
                int slashIdx = path.lastIndexOf('/');
                String last = slashIdx >= 0 ? path.substring(slashIdx + 1) : path;
                if (StringUtils.hasText(last)) {
                    return last;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String matchGroup(String source, String regex) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(regex).matcher(source);
        return matcher.find() ? matcher.group(1) : null;
    }

    private String getText(JsonNode node, String fieldName) {
        return getText(node, fieldName, null);
    }

    private String getText(JsonNode node, String fieldName, String defaultValue) {
        JsonNode valueNode = node.get(fieldName);
        return valueNode == null || valueNode.isNull() ? defaultValue : valueNode.asText();
    }
}
