package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.TypeReference;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.util.http.ByHttpClient;
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
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
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
    // datacloud 的 ontology-server 是标准 REST：读=GET（查询参数走 query string）、建=POST、更新=PUT、删=DELETE。
    // 路径参数（ownerType/baseId/sceneId/...）拼进 URL；GET 的过滤参数放 queryParams，POST 放 body。
    // 响应出口统一把 snake_case 键名归一化为 camelCase（datacloud 实跑返回 snake_case，前端/本端按 camelCase 消费）。
    private static final String ONTOLOGY_BASE_PATH = "/api/v1/ontologyBases";

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

    /** PUT 转发：请求参数走 body。 */
    private <T> T putOntologyData(String path, Object body, TypeReference<DataCloudResponse<T>> typeRef) {
        Object requestBody = body == null ? new HashMap<>() : body;
        try {
            logger.info("datacloud ontology PUT, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody));
            HttpResponse response = discoveryHttpClient.put(serviceName, path, buildHeaders(), requestBody, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology PUT failed, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody), e);
            return null;
        }
    }

    /** DELETE 转发：查询参数走 query string，无 body。 */
    private <T> T deleteOntologyData(String path, Map<String, Object> queryParams,
        TypeReference<DataCloudResponse<T>> typeRef) {
        Map<String, Object> query = queryParams == null ? new HashMap<>() : queryParams;
        try {
            logger.info("datacloud ontology DELETE, serviceName={}, path={}, query={}", serviceName, path,
                toJsonString(query));
            HttpResponse response = discoveryHttpClient.delete(serviceName, path, buildHeaders(), query)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology DELETE failed, serviceName={}, path={}, query={}", serviceName, path,
                toJsonString(query), e);
            return null;
        }
    }

    /** DELETE 转发：少数 datacloud 接口（如场景成员删除）按 OpenAPI 要求使用 DELETE body。 */
    private <T> T deleteOntologyDataWithBody(String path, Object body, TypeReference<DataCloudResponse<T>> typeRef) {
        Object requestBody = body == null ? new HashMap<>() : body;
        try {
            logger.info("datacloud ontology DELETE_BODY, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody));
            HttpResponse response = requestWithBody("DELETE", path, requestBody, null);
            return parseAndNormalize(path, response, typeRef);
        }
        catch (Exception e) {
            logger.error("datacloud ontology DELETE_BODY failed, serviceName={}, path={}, body={}", serviceName, path,
                toJsonString(requestBody), e);
            return null;
        }
    }

    /** DiscoveryHttpClient.delete 不支持 body，这里用同一服务发现结果构造 ByHttpClient 通用请求。 */
    private HttpResponse requestWithBody(String method, String path, Object body, Map<String, Object> queryParams)
        throws Exception {
        Optional<ServiceInstance> instance = discoveryClient.discover(serviceName);
        if (instance.isEmpty()) {
            throw new IllegalStateException("datacloud service instance not found: " + serviceName);
        }
        ServiceInstance serviceInstance = instance.get();
        String protocol = serviceInstance.getProtocol() == null ? "http" : serviceInstance.getProtocol();
        String pathPrefix = StringUtils.defaultString(serviceInstance.getPathPrefix());
        String baseUrl = protocol + "://" + serviceInstance.getHost() + ":" + serviceInstance.getPort() + pathPrefix;
        try (ByHttpClient client = ByHttpClient.builder().baseUrl(baseUrl).retryConfig(RETRY_CONFIG)
            .timeout(gatewaySecondTimeOut.intValue()).build()) {
            return client.request(method, path, buildHeaders(), queryParams == null ? new HashMap<>() : queryParams, body,
                null, gatewaySecondTimeOut.intValue()).get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
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

    private static String pathValue(String value) {
        return URLEncoder.encode(StringUtils.defaultString(value), StandardCharsets.UTF_8);
    }

    private static Map<String, Object> queryOf(Object... keyValues) {
        Map<String, Object> query = new HashMap<>();
        if (keyValues == null) {
            return query;
        }
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            Object value = keyValues[i + 1];
            if (value != null && StringUtils.isNotBlank(String.valueOf(value))) {
                query.put(String.valueOf(keyValues[i]), value);
            }
        }
        return query;
    }

    /** 列出全部本体库（GET /api/v1/ontologyBases?keyword=）。 */
    public JSONArray listOntologyBases() {
        return listOntologyBases(null);
    }

    /** 列出全部本体库（GET /api/v1/ontologyBases?keyword=）。 */
    public JSONArray listOntologyBases(String keyword) {
        return getOntologyData(ONTOLOGY_BASE_PATH, queryOf("keyword", keyword),
            new TypeReference<DataCloudResponse<JSONArray>>() {
            });
    }

    /** 按 ownerType 列出本体库（GET /api/v1/ontologyBases/{ownerType}?keyword=）。 */
    public JSONArray listOntologyBasesByOwner(String ownerType, String keyword) {
        return getOntologyData(ONTOLOGY_BASE_PATH + "/" + pathValue(ownerType), queryOf("keyword", keyword),
            new TypeReference<DataCloudResponse<JSONArray>>() {
            });
    }

    /** 查询本体库（GET /api/v1/ontologyBases/{ownerType}?keyword=）兼容旧调用。 */
    public JSONArray listOntologyBases(String ownerType, String keyword) {
        if (StringUtils.isBlank(ownerType)) {
            return listOntologyBases(keyword);
        }
        return listOntologyBasesByOwner(ownerType, keyword);
    }

    /** 创建/注册本体库（POST /api/v1/ontologyBases）。 */
    public JSONObject createOntologyBase(Map<String, Object> body) {
        return postOntologyData(ONTOLOGY_BASE_PATH, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 更新本体库（PUT /api/v1/ontologyBases/{baseId}）。 */
    public JSONObject updateOntologyBase(String baseId, Map<String, Object> body) {
        return putOntologyData(ONTOLOGY_BASE_PATH + "/" + pathValue(baseId), body,
            new TypeReference<DataCloudResponse<JSONObject>>() {
            });
    }

    /** 删除/注销本体库（DELETE /api/v1/ontologyBases/{baseId}）。 */
    public JSONObject deleteOntologyBase(String baseId) {
        return deleteOntologyData(ONTOLOGY_BASE_PATH + "/" + pathValue(baseId), null,
            new TypeReference<DataCloudResponse<JSONObject>>() {
            });
    }

    /** 删除/注销本体库（兼容旧签名，ownerType 不再作为 datacloud 路径参数）。 */
    public JSONObject deleteOntologyBase(String ownerType, String baseId) {
        return deleteOntologyBase(baseId);
    }

    /** 列出本体库下的场景（GET /api/v1/ontologyBases/{baseId}/scenes?keyword=&cache_mode=）。 */
    public JSONArray listScenes(String ownerType, String baseId, String queryKeyword) {
        return listScenesByBase(baseId, queryKeyword, null);
    }

    public JSONArray listScenesByBase(String baseId, String keyword, String cacheMode) {
        String path = String.format("%s/%s/scenes", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return getOntologyData(path, queryOf("keyword", keyword, "cache_mode", cacheMode),
            new TypeReference<DataCloudResponse<JSONArray>>() {
            });
    }

    /** 创建场景（POST /api/v1/ontologyBases/{baseId}/scenes）。 */
    public JSONObject createScene(String baseId, Map<String, Object> body) {
        String path = String.format("%s/%s/scenes", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 查询场景详情（GET /api/v1/ontologyBases/{baseId}/scenes/{sceneId}）。 */
    public JSONObject getSceneDetails(String ownerType, String baseId, String sceneId) {
        return getSceneDetails(baseId, sceneId, null, null, null);
    }

    public JSONObject getSceneDetails(String baseId, String sceneId, String viewCode, String objectCode,
        String cacheMode) {
        String path = String.format("%s/%s/scenes/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(sceneId));
        return getOntologyData(path, queryOf("viewCode", viewCode, "objectCode", objectCode, "cache_mode", cacheMode),
            new TypeReference<DataCloudResponse<JSONObject>>() {
            });
    }

    /** 更新场景（PUT /api/v1/ontologyBases/{baseId}/scenes/{sceneId}）。 */
    public JSONObject updateScene(String baseId, String sceneId, Map<String, Object> body) {
        String path = String.format("%s/%s/scenes/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(sceneId));
        return putOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除场景（DELETE /api/v1/ontologyBases/{baseId}/scenes/{sceneId}）。 */
    public JSONObject deleteScene(String baseId, String sceneId) {
        String path = String.format("%s/%s/scenes/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(sceneId));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 场景下本体分页查询（GET /api/v1/ontologyBases/{baseId}/scenes/{sceneId}/ontologies）。 */
    public JSONObject queryOntologiesByScene(String baseId, String sceneId, Integer page, Integer pageSize,
        String keyword, String cacheMode) {
        String path = String.format("%s/%s/scenes/%s/ontologies", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(sceneId));
        return getOntologyData(path,
            queryOf("page", page, "pageSize", pageSize, "keyword", keyword, "cache_mode", cacheMode),
            new TypeReference<DataCloudResponse<JSONObject>>() {
            });
    }

    /** 添加场景成员（POST /api/v1/ontologyBases/{baseId}/scenes/{sceneId}/members）。 */
    public JSONObject addSceneMembers(String baseId, String sceneId, Map<String, Object> body) {
        String path = String.format("%s/%s/scenes/%s/members", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(sceneId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 移除场景成员（DELETE /api/v1/ontologyBases/{baseId}/scenes/{sceneId}/members，body 传成员）。 */
    public JSONObject removeSceneMembers(String baseId, String sceneId, Map<String, Object> body) {
        String path = String.format("%s/%s/scenes/%s/members", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(sceneId));
        return deleteOntologyDataWithBody(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的对象（GET /api/v1/ontologyBases/{baseId}/objects）。 */
    public JSONArray listObjects(String ownerType, String baseId, String keyword) {
        return listObjects(baseId, null);
    }

    public JSONArray listObjects(String baseId, String cacheMode) {
        String path = String.format("%s/%s/objects", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建对象（POST /api/v1/ontologyBases/{baseId}/objects）。 */
    public JSONObject createObject(String baseId, Map<String, Object> body) {
        String path = String.format("%s/%s/objects", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 获取对象详情（GET /api/v1/ontologyBases/{baseId}/objects/{code}）。 */
    public JSONObject getObjectDetail(String ownerType, String baseId, String objectCode) {
        return getObjectDetailByCode(baseId, objectCode, null);
    }

    public JSONObject getObjectDetailByCode(String baseId, String objectCode, String cacheMode) {
        String path = String.format("%s/%s/objects/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(objectCode));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 更新对象（PUT /api/v1/ontologyBases/{baseId}/objects/{code}）。 */
    public JSONObject updateObject(String baseId, String objectCode, Map<String, Object> body) {
        String path = String.format("%s/%s/objects/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(objectCode));
        return putOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除对象（DELETE /api/v1/ontologyBases/{baseId}/objects/{code}）。 */
    public JSONObject deleteObject(String baseId, String objectCode) {
        String path = String.format("%s/%s/objects/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(objectCode));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的视图（GET /api/v1/ontologyBases/{baseId}/views）。 */
    public JSONArray listViews(String ownerType, String baseId) {
        return listViewsByBase(baseId, null);
    }

    public JSONArray listViewsByBase(String baseId, String cacheMode) {
        String path = String.format("%s/%s/views", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建视图（POST /api/v1/ontologyBases/{baseId}/views）。 */
    public JSONObject createView(String baseId, Map<String, Object> body) {
        String path = String.format("%s/%s/views", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 查询视图详情（GET /api/v1/ontologyBases/{baseId}/views/{code}）。 */
    public JSONObject getViewDetail(String baseId, String viewCode, String cacheMode) {
        String path = String.format("%s/%s/views/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(viewCode));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 更新视图（PUT /api/v1/ontologyBases/{baseId}/views/{code}）。 */
    public JSONObject updateView(String baseId, String viewCode, Map<String, Object> body) {
        String path = String.format("%s/%s/views/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(viewCode));
        return putOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除视图（DELETE /api/v1/ontologyBases/{baseId}/views/{code}）。 */
    public JSONObject deleteView(String baseId, String viewCode) {
        String path = String.format("%s/%s/views/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(viewCode));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出本体库下的关系（GET /api/v1/ontologyBases/{baseId}/relations）。 */
    public JSONArray listRelations(String ownerType, String baseId) {
        return listRelationsByBase(baseId, null);
    }

    public JSONArray listRelationsByBase(String baseId, String cacheMode) {
        String path = String.format("%s/%s/relations", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建关系（POST /api/v1/ontologyBases/{baseId}/relations）。 */
    public JSONObject createRelation(String baseId, Map<String, Object> body) {
        String path = String.format("%s/%s/relations", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 查询关系详情（GET /api/v1/ontologyBases/{baseId}/relations/{code}）。 */
    public JSONObject getRelationDetail(String baseId, String relationCode, String cacheMode) {
        String path = String.format("%s/%s/relations/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(relationCode));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 更新关系（PUT /api/v1/ontologyBases/{baseId}/relations/{code}）。 */
    public JSONObject updateRelation(String baseId, String relationCode, Map<String, Object> body) {
        String path = String.format("%s/%s/relations/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(relationCode));
        return putOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除关系（DELETE /api/v1/ontologyBases/{baseId}/relations/{code}）。 */
    public JSONObject deleteRelation(String baseId, String relationCode) {
        String path = String.format("%s/%s/relations/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(relationCode));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出数据源（GET /api/v1/ontologyBases/{baseId}/datasources）。 */
    public JSONArray listDatasources(String baseId, String cacheMode) {
        String path = String.format("%s/%s/datasources", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建数据源（POST /api/v1/ontologyBases/{baseId}/datasources）。 */
    public JSONObject createDatasource(String baseId, Map<String, Object> body) {
        String path = String.format("%s/%s/datasources", ONTOLOGY_BASE_PATH, pathValue(baseId));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 查询数据源详情（GET /api/v1/ontologyBases/{baseId}/datasources/{dbId}）。 */
    public JSONObject getDatasourceDetail(String baseId, String dbId, String cacheMode) {
        String path = String.format("%s/%s/datasources/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(dbId));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除数据源（DELETE /api/v1/ontologyBases/{baseId}/datasources/{dbId}）。 */
    public JSONObject deleteDatasource(String baseId, String dbId) {
        String path = String.format("%s/%s/datasources/%s", ONTOLOGY_BASE_PATH, pathValue(baseId), pathValue(dbId));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 列出对象动作（GET /api/v1/ontologyBases/{baseId}/objects/{objectCode}/actions）。 */
    public JSONArray listActions(String baseId, String objectCode, String cacheMode) {
        String path = String.format("%s/%s/objects/%s/actions", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(objectCode));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONArray>>() {
        });
    }

    /** 创建对象动作（POST /api/v1/ontologyBases/{baseId}/objects/{objectCode}/actions）。 */
    public JSONObject createAction(String baseId, String objectCode, Map<String, Object> body) {
        String path = String.format("%s/%s/objects/%s/actions", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(objectCode));
        return postOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 查询对象动作详情（GET /api/v1/ontologyBases/{baseId}/objects/{objectCode}/actions/{code}）。 */
    public JSONObject getActionDetail(String baseId, String objectCode, String actionCode, String cacheMode) {
        String path = String.format("%s/%s/objects/%s/actions/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(objectCode), pathValue(actionCode));
        return getOntologyData(path, queryOf("cache_mode", cacheMode), new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 更新对象动作（PUT /api/v1/ontologyBases/{baseId}/objects/{objectCode}/actions/{code}）。 */
    public JSONObject updateAction(String baseId, String objectCode, String actionCode, Map<String, Object> body) {
        String path = String.format("%s/%s/objects/%s/actions/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(objectCode), pathValue(actionCode));
        return putOntologyData(path, body, new TypeReference<DataCloudResponse<JSONObject>>() {
        });
    }

    /** 删除对象动作（DELETE /api/v1/ontologyBases/{baseId}/objects/{objectCode}/actions/{code}）。 */
    public JSONObject deleteAction(String baseId, String objectCode, String actionCode) {
        String path = String.format("%s/%s/objects/%s/actions/%s", ONTOLOGY_BASE_PATH, pathValue(baseId),
            pathValue(objectCode), pathValue(actionCode));
        return deleteOntologyData(path, null, new TypeReference<DataCloudResponse<JSONObject>>() {
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
