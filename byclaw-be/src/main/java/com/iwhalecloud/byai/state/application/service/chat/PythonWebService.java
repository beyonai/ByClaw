package com.iwhalecloud.byai.state.application.service.chat;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import com.iwhalecloud.byai.common.constants.env.EnvConfigKey;
import com.iwhalecloud.byai.common.util.UrlUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import org.apache.commons.codec.digest.DigestUtils;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class PythonWebService {

    private final RestTemplate restTemplate = new RestTemplate();

    public BufferedReader requestPythonWeb(Map<String, Object> requestBody, String pythonUrl) {
        try {
            URL url = new URL(pythonUrl);

            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            // // 以下这些消息头，是原版代码里默认加上的。显式加上的只有Accept
            connection.addRequestProperty("Accept", "application/json, text/plain, */*");
            connection.addRequestProperty("Content-Length", "1198");
            connection.addRequestProperty("Content-Type", "application/json");
            connection.addRequestProperty("User-Agent", "OpenAI/JS 4.23.0");
            connection.addRequestProperty("X-Stainless-Lang", "js");
            connection.addRequestProperty("X-Stainless-Package-Version", "4.23.0");
            connection.addRequestProperty("X-Stainless-OS", "Windows");
            connection.addRequestProperty("X-Stainless-Arch", "x64");
            connection.addRequestProperty("X-Stainless-Runtime", "node");
            connection.addRequestProperty("X-Stainless-Runtime-Version", "v18.19.0");
            String requestBodyStr = JSON.toJSONString(requestBody, SerializerFeature.DisableCircularReferenceDetect);
            log.info("即将发起请求访问python web，url= " + pythonUrl + "\nbody= \n" + requestBodyStr);

            // 开始向llm发送请求
            OutputStream outputStream = connection.getOutputStream();
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
            writer.write(requestBodyStr);
            writer.flush();
            writer.close();
            outputStream.close();

            InputStream inputStream = connection.getInputStream();
            return new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));

        }
        catch (IOException e) {
            log.error(e.getMessage(), e);
            throw new BdpRuntimeException(e.getMessage(), e);
        }
    }

    public BufferedReader requestPythonWeb(Map<String, Object> requestBody) {
        String completionPythonAssistantChatUL = UrlUtil.getCompletionPythonAssistantChatURL();
        return requestPythonWeb(requestBody, completionPythonAssistantChatUL);
    }

    public void appendEvent(Map<String, Object> requestBody) {
        String completionPythonSyncChatEventUrL = UrlUtil.getCompletionPythonSyncChatEventUrL();
        execPythonWeb(requestBody, completionPythonSyncChatEventUrL);
    }

    public void execPythonWeb(Map<String, Object> requestBody, String url) {

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, getHeaders(requestBody));
        try {
            // 发送请求
            restTemplate.postForEntity(url, entity, String.class);
        }
        catch (RestClientException e) {
            log.error(e.getMessage(), e);
        }
    }

    private HttpHeaders getHeaders(Map<String, Object> requestBody) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String timestamp = String.valueOf(System.currentTimeMillis());
        headers.set("X-Signature", generateSignature(timestamp, requestBody));
        headers.set("X-Timestamp", timestamp);
        headers.set("X-Access-Key", ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_ACCESS_KEY));
        return headers;
    }

    private String generateSignature(String timestamp, Map<String, Object> data) {
        String accessKey = ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_ACCESS_KEY);
        String secretKey = ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_SECRET_KEY);
        String body = JSONObject.toJSONString(data);
        log.info("请求python的参数：{}", body);
        String signStr = accessKey + timestamp + body + secretKey;
        return DigestUtils.sha256Hex(signStr).toUpperCase();
    }

}
