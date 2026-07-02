package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.TypeReference;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhaleai.byai.framework.util.http.HttpResponse;
import com.iwhaleai.byai.framework.util.http.RetryConfig;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.feign.request.datacloud.TermsOptionsReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.TermsOptionsResp;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * @author he.duming
 * @date 2026-05-25 18:25:37
 * @description TODO
 */
@Service
public class FeignDataCloudService {

    private Logger logger = LoggerFactory.getLogger(FeignDataCloudService.class);

    private RetryConfig RETRY_CONFIG = RetryConfig.builder().maxAttempts(3).retryOnStatusCodes(Set.of(502, 503, 504))
        .build();

    @Value("${spring.application.datacloudName:byclaw-datacloud}")
    private String serviceName;

    @Value("${gateway.second.timeout:300}")
    private Long gatewaySecondTimeOut = 5 * 60L;

    @Autowired
    private JwtService jwtService;

    @Autowired
    @Qualifier("redisClient")
    private RedisClient redisClient;

    private DiscoveryClient discoveryClient;

    private DiscoveryHttpClient discoveryHttpClient;

    @PostConstruct
    public void init() {
        this.discoveryClient = new DiscoveryClient(redisClient, 5);
        this.discoveryHttpClient = DiscoveryHttpClient.builder().discoveryClient(discoveryClient)
            .retryConfig(RETRY_CONFIG).build();
    }

    /**
     * 统一执行知识库 POST 请求，根据路由结果决定走服务发现还是第三方直连。
     */
    public DataCloudResponse<TermsOptionsResp> termsOptions(TermsOptionsReq termsOptionsReq) {

        try {

            HttpResponse response = discoveryHttpClient
                .post(serviceName, "/api/v1/datacloud/terms/options", buildHeaders(), termsOptionsReq, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);

            String body = JSON.toJSONString(response.getData());

            return JSON.parseObject(body, new TypeReference<DataCloudResponse<TermsOptionsResp>>() {
            });
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
        }
    }

    // ============================ 本体（Ontology）服务转发 ============================
    // datacloud 的 ontology-server 是标准 REST：读=GET（查询参数走 query string）、建=POST、删=DELETE。
    // 路径参数（ownerType/baseId/sceneId/...）拼进 URL；GET 的过滤参数放 queryParams，POST 放 body。
    // 响应出口统一把 snake_case 键名归一化为 camelCase（datacloud 实跑返回 snake_case，前端/本端按 camelCase 消费）。

    /** GET 转发：查询参数走 query string，无 body。 */
    private <T> T getOntologyData(String path, Map<String, Object> queryParams,
        TypeReference<DataCloudResponse<T>> typeRef) {
        Map<String, Object> query = queryParams == null ? new HashMap<>() : queryParams;
        try {
            logger.info("datacloud ontology GET, serviceName={}, path={}, query={}", serviceName, path,
                toJsonString(query));
            HttpResponse response = discoveryHttpClient.get(serviceName, path, buildHeaders(), query)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology GET failed, serviceName={}, path={}, query={}", serviceName, path,
                toJsonString(query), e);
            return null;
        }
    }

    /** POST 转发：请求参数走 body。 */
    private <T> T postOntologyData(String path, Object body, TypeReference<DataCloudResponse<T>> typeRef) {
        Object requestBody = body == null ? new HashMap<>() : body;
        try {
            logger.info("datacloud ontology POST, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody));
            HttpResponse response = discoveryHttpClient.post(serviceName, path, buildHeaders(), requestBody, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology POST failed, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody), e);
            return null;
        }
    }

    /** DELETE 转发：无 body。 */
    private <T> T deleteOntologyData(String path, TypeReference<DataCloudResponse<T>> typeRef) {
        try {
            logger.info("datacloud ontology DELETE, serviceName={}, path={}", serviceName, path);
            HttpResponse response = discoveryHttpClient.delete(serviceName, path, buildHeaders(), new HashMap<>())
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology DELETE failed, serviceName={}, path={}", serviceName, path, e);
            return null;
        }
    }

    /** 解析 DataCloudResponse 并对业务 data 做 snake→camel 键名归一化。 */
    @SuppressWarnings("unchecked")
    private <T> T parseAndNormalize(String path, HttpResponse response, TypeReference<DataCloudResponse<T>> typeRef) {
        String resBody = JSON.toJSONString(response.getData());
        logger.info("datacloud ontology raw response, serviceName={}, path={}, response={}", serviceName, path, resBody);
        DataCloudResponse<T> parsed = JSON.parseObject(resBody, typeRef);
        T data = parsed == null ? null : parsed.getData();
        if (data instanceof JSONObject || data instanceof JSONArray) {
            data = (T) normalizeKeys(data);
        }
        logger.info("datacloud ontology response data, serviceName={}, path={}, data={}", serviceName, path,
            toJsonString(data));
        return data;
    }

    /** 递归把 JSON 的 snake_case 键名转成 camelCase，兼容 datacloud 实跑返回 snake_case。 */
    private static Object normalizeKeys(Object node) {
        if (node instanceof JSONObject) {
            JSONObject src = (JSONObject) node;
            JSONObject out = new JSONObject();
            for (Map.Entry<String, Object> entry : src.entrySet()) {
                out.put(toCamelCase(entry.getKey()), normalizeKeys(entry.getValue()));
            }
            return out;
        }
        if (node instanceof JSONArray) {
            JSONArray src = (JSONArray) node;
            JSONArray out = new JSONArray();
            for (Object item : src) {
                out.add(normalizeKeys(item));
            }
            return out;
        }
        return node;
    }

    /** snake_case → camelCase；无下划线（已是 camelCase 或单词）原样返回。 */
    private static String toCamelCase(String key) {
        if (key == null || key.indexOf('_') < 0) {
            return key;
        }
        StringBuilder sb = new StringBuilder(key.length());
        boolean upperNext = false;
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c == '_') {
                upperNext = true;
            }
            else if (upperNext) {
                sb.append(Character.toUpperCase(c));
                upperNext = false;
            }
            else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private String toJsonString(Object value) {
        try {
            return JSON.toJSONString(value);
        }
        catch (Exception e) {
            return String.valueOf(value);
        }
    }

    /** 列出全部本体库（GET /api/v1/ontologyBases）。 */
    public JSONArray listOntologyBases() {
        return getOntologyData("/api/v1/ontologyBases", null, new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建/注册本体库（POST /api/v1/ontologyBases）。 */
    public JSONObject createOntologyBase(Map<String, Object> body) {
        return postOntologyData("/api/v1/ontologyBases", body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除/注销本体库（DELETE /api/v1/ontologyBases/{ownerType}/{baseId}）。 */
    public JSONObject deleteOntologyBase(String ownerType, String baseId) {
        String path = String.format("/api/v1/ontologyBases/%s/%s", ownerType, baseId);
        return deleteOntologyData(path, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的场景（GET .../scenes?queryKeyword=）。 */
    public JSONArray listScenes(String ownerType, String baseId, String queryKeyword) {
        Map<String, Object> query = new HashMap<>();
        if (queryKeyword != null) {
            query.put("queryKeyword", queryKeyword);
        }
        String path = String.format("/api/v1/ontologyBases/%s/%s/scenes", ownerType, baseId);
        return getOntologyData(path, query, new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 查询场景详情：对象/视图/关系/动作/数据源（GET .../scenes/{sceneId}）。 */
    public JSONObject getSceneDetails(String ownerType, String baseId, String sceneId) {
        String path = String.format("/api/v1/ontologyBases/%s/%s/scenes/%s", ownerType, baseId, sceneId);
        return getOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的对象（GET .../objects?keyword=）。 */
    public JSONArray listObjects(String ownerType, String baseId, String keyword) {
        Map<String, Object> query = new HashMap<>();
        if (keyword != null) {
            query.put("keyword", keyword);
        }
        String path = String.format("/api/v1/ontologyBases/%s/%s/objects", ownerType, baseId);
        return getOntologyData(path, query, new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 获取对象详情：属性 + 动作（GET .../objects/{objectCode}）。 */
    public JSONObject getObjectDetail(String ownerType, String baseId, String objectCode) {
        String path = String.format("/api/v1/ontologyBases/%s/%s/objects/%s", ownerType, baseId, objectCode);
        return getOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的视图（GET .../views）。 */
    public JSONArray listViews(String ownerType, String baseId) {
        String path = String.format("/api/v1/ontologyBases/%s/%s/views", ownerType, baseId);
        return getOntologyData(path, null, new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 列出本体库下的关系（GET .../relations）。 */
    public JSONArray listRelations(String ownerType, String baseId) {
        String path = String.format("/api/v1/ontologyBases/%s/%s/relations", ownerType, baseId);
        return getOntologyData(path, null, new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /**
     * JSON Content-Type；优先 Session Cookie，否则 Beyond-Token。
     *
     * @return 请求头
     */
    private Map<String, String> buildHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        return this.addAuth(headers);
    }

    /***
     * 增加认证信息
     *
     * @param headers 请求头
     * @return Map
     */
    private Map<String, String> addAuth(Map<String, String> headers) {

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null) {
            headers.put("System-Code", SystemCode.BYAI.getCode());
            headers.put("Beyond-Token", jwtService.createJwt(loginInfo));
        }
        return headers;
    }
}
