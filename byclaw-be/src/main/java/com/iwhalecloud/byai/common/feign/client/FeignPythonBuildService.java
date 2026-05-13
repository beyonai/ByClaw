package com.iwhalecloud.byai.common.feign.client;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.TypeReference;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.util.http.ByHttpClient;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhaleai.byai.framework.util.http.HttpResponse;
import com.iwhaleai.byai.framework.util.http.RetryConfig;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.FileBuildStatus;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDelete;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBaseInfo;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.StringUtil;
import jakarta.annotation.PostConstruct;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 经 Redis 服务发现调用 Python 知识构建服务；默认 JSON 请求。配置：spring.application.qADomainName、feign.python.build.path（可选前缀）。
 */
@Service
public class FeignPythonBuildService {

    private final Logger logger = LoggerFactory.getLogger(FeignPythonBuildService.class);

    private static final RetryConfig RETRY_CONFIG = RetryConfig.builder().maxAttempts(3)
        .retryOnStatusCodes(Set.of(502, 503, 504)).build();

    @Value("${spring.application.qADomainName:byclaw-qa-manager}")
    private String serviceName;

    @Value("${gateway.second.timeout:300}")
    private Long gatewaySecondTimeOut = 5 * 60L;

    @Autowired
    @Qualifier("redisClient")
    private RedisClient redisClient;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private KnowledgeServiceEndpointResolver knowledgeServiceEndpointResolver;

    @Autowired
    private KnowledgeServicePathResolver knowledgeServicePathResolver;

    private DiscoveryClient discoveryClient;

    private DiscoveryHttpClient discoveryHttpClient;

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    /** 初始化发现客户端、DiscoveryHttpClient（重试）、ByHttpClient（直链下载）。 */
    @PostConstruct
    public void init() {
        this.discoveryClient = new DiscoveryClient(redisClient, 5);
        this.discoveryHttpClient = DiscoveryHttpClient.builder().discoveryClient(discoveryClient)
            .retryConfig(RETRY_CONFIG).build();
    }

    /**
     * 创建知识库。
     *
     * @param knowledgeBaseCreate 创建请求体
     * @param throwExceptions
     * @return 成功时含 KnowledgeBaseInfo
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<KnowledgeBaseInfo> createKnowledgeBase(KbKnowledgeCreate knowledgeBaseCreate,
        boolean throwExceptions) {
        return post(KnowledgeServiceOperation.CREATE_KB, knowledgeBaseCreate,
            new TypeReference<PythonBuildResponse<KnowledgeBaseInfo>>() {
            }, throwExceptions);
    }

    /**
     * 删除知识库。
     *
     * @param kbKnowledgeDelete 含 knCode
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> deleteKnowledgeBase(KbKnowledgeDelete kbKnowledgeDelete) {
        return post(KnowledgeServiceOperation.DELETE_KB, kbKnowledgeDelete,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 更新知识库名称或描述。
     *
     * @param kbKnowledgeUpdate 含 knCode 及待更新字段
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> updateKnowledgeBase(KbKnowledgeUpdate kbKnowledgeUpdate) {
        return post(KnowledgeServiceOperation.UPDATE_KB, kbKnowledgeUpdate,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 创建目录（可多级）。
     *
     * @param kbDirectoryCreate knCode、directoryPath 等
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> createDirectory(KbDirectoryCreate kbDirectoryCreate) {
        return post(KnowledgeServiceOperation.CREATE_DIR, kbDirectoryCreate,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 删除目录。
     *
     * @param kbDirectoryDelete knCode、directoryPath
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> deleteDirectory(KbDirectoryDelete kbDirectoryDelete) {
        return post(KnowledgeServiceOperation.DELETE_DIR, kbDirectoryDelete,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 重命名目录最后一级。
     *
     * @param kbDirectoryUpdate knCode、原路径、新目录名
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> updateDirectory(KbDirectoryUpdate kbDirectoryUpdate) {
        return post(KnowledgeServiceOperation.EDIT_DIR, kbDirectoryUpdate,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 列出目录或者文件
     *
     * @param kbListDir 列出文件
     * @return PythonBuildResponse<DirOrFile>
     */
    public PythonBuildResponse<Data> listDir(KbListDir kbListDir) {
        return post(KnowledgeServiceOperation.LIST_DIR, kbListDir, new TypeReference<PythonBuildResponse<Data>>() {
        });
    }

    /**
     * 导入文件到知识库（multipart/form-data）。
     *
     * @param kbFileImport 导入参数
     * @return 成功时含 KbImportResult
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<KbImportResult> importKnowledgeItem(KbFileImport kbFileImport) {
        try {

            // 文件信息
            MultipartFile multipartFile = kbFileImport.getMultipartFile();
            String originalFilename = multipartFile.getOriginalFilename();
            ByHttpClient.InputStreamSupplier streamSupplier = () -> multipartFile.getInputStream();

            // 表单参数
            Map<String, String> formFields = new HashMap<>();
            formFields.put("knCode", kbFileImport.getKnCode());
            formFields.put("filePath", kbFileImport.getFilePath());
            formFields.put("fileDescription", kbFileImport.getFileDescription());

            String requestPath = resolvePath(kbFileImport, KnowledgeServiceOperation.UPLOAD_FILE);
            KnowledgeServiceEndpoint endpoint = resolveRoute(kbFileImport);
            if (endpoint.isDirectUrl()) {
                return directUpload(endpoint.getBaseUrl(), requestPath, originalFilename, multipartFile, formFields,
                    new TypeReference<PythonBuildResponse<KbImportResult>>() {
                    });
            }
            HttpResponse httpResponse = discoveryHttpClient.upload(endpoint.getServiceName(), requestPath,
                originalFilename, "fileContent", streamSupplier, this.buildUploadHeaders(), formFields).get();

            return this.parseResponse(httpResponse, new TypeReference<PythonBuildResponse<KbImportResult>>() {
            }, requestPath);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("调用 Python 构建服务失败: ", e);
        }
    }

    /**
     * 删除知识库文档。
     *
     * @param temDelete 删除条件
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> deleteKnowledgeItem(KbFileDelete temDelete) {
        return post(KnowledgeServiceOperation.DELETE_FILE, temDelete, new TypeReference<PythonBuildResponse<Void>>() {
        });
    }

    /**
     * 根据文件路径异步构建指定知识库下的文件，自动完成原始文件转 Markdown、切片和切片向量化处理。
     *
     * @param kbFileToMarkdownIndex 构建的文件信息
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> fileToMarkdownIndex(KbFileToMarkdownIndex kbFileToMarkdownIndex) {
        return post(KnowledgeServiceOperation.KNOWLEDGE_BUILD, kbFileToMarkdownIndex,
            new TypeReference<PythonBuildResponse<Void>>() {
            });
    }

    /**
     * 下载原始文件流
     *
     * @param kbFileDownload 文件下载信息
     * @return 文件流
     * @throws BaseException 调用失败
     */
    public InputStream fileDownload(KbFileDownload kbFileDownload) {
        try {
            String requestPath = resolvePath(kbFileDownload, KnowledgeServiceOperation.DOWNLOAD_FILE);
            KnowledgeServiceEndpoint endpoint = resolveRoute(kbFileDownload);
            if (endpoint.isDirectUrl()) {
                return directDownload(endpoint.getBaseUrl(), requestPath, kbFileDownload);
            }

            CompletableFuture<InputStream> completableFuture = discoveryHttpClient.download("POST",
                endpoint.getServiceName(), requestPath, this.buildHeaders(), null, kbFileDownload, null);
            // 提取文件流
            return completableFuture.get();
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("调用 Python 构建服务下载接口失败", e);
        }
    }

    /**
     * 文件构建
     *
     * @param fileBuildStatus 入参
     * @return PythonBuildResponse
     */
    public PythonBuildResponse<ProcessStatus> fileBuildStatus(FileBuildStatus fileBuildStatus) {
        return post(KnowledgeServiceOperation.FILE_BUILD_STATUS, fileBuildStatus,
            new TypeReference<PythonBuildResponse<ProcessStatus>>() {
            });
    }

    /**
     * JSON POST，60s 超时，经服务发现。
     *
     * @param payload 请求体
     * @param type 反序列化类型
     * @param <T> resultObject 类型
     * @return PythonBuildResponse
     * @throws BaseException 失败时
     */
    private <T> PythonBuildResponse<T> post(KnowledgeServiceOperation operation, Object payload,
        TypeReference<PythonBuildResponse<T>> type) {
        try {
            return doPost(operation, payload, type);
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            throw new BaseException("调用 Python 构建服务失败: " + operation.getOperationId(), e);
        }
    }

    private <T> PythonBuildResponse<T> post(KnowledgeServiceOperation operation, Object payload,
        TypeReference<PythonBuildResponse<T>> type, boolean throwExceptions) {
        try {
            return doPost(operation, payload, type);
        }
        catch (BaseException e) {
            if (throwExceptions) {
                throw e;
            }
            logger.error("调用 Python 构建服务失败: {}", operation.getOperationId(), e);
            PythonBuildResponse<T> fallback = new PythonBuildResponse<>();
            fallback.setResultCode("-1");
            fallback.setResultMsg(e.getMessage());
            return fallback;
        }
        catch (Exception e) {
            if (throwExceptions) {
                throw new BaseException("调用 Python 构建服务失败: " + operation.getOperationId(), e);
            }
            logger.error("调用 Python 构建服务失败: {}", operation.getOperationId(), e);
            PythonBuildResponse<T> fallback = new PythonBuildResponse<>();
            fallback.setResultCode("-1");
            fallback.setResultMsg(e.getMessage());
            return fallback;
        }
    }

    /**
     * 统一执行知识库 POST 请求，根据路由结果决定走服务发现还是第三方直连。
     */
    private <T> PythonBuildResponse<T> doPost(KnowledgeServiceOperation operation, Object payload,
        TypeReference<PythonBuildResponse<T>> type) throws Exception {
        String requestPath = resolvePath(payload, operation);
        KnowledgeServiceEndpoint endpoint = resolveRoute(payload);
        if (endpoint.isDirectUrl()) {
            return directPost(endpoint.getBaseUrl(), requestPath, payload, type);
        }
        HttpResponse response = discoveryHttpClient
            .post(endpoint.getServiceName(), requestPath, buildHeaders(), payload, null)
            .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);
        return parseResponse(response, type, requestPath);
    }

    /**
     * 校验成功并解析为 PythonBuildResponse。
     *
     * @param response HTTP 响应
     * @param type 目标类型
     * @param path 日志用路径
     * @param <T> 泛型
     * @return 解析结果
     * @throws BaseException 空响应或非成功状态
     */
    private <T> PythonBuildResponse<T> parseResponse(HttpResponse response, TypeReference<PythonBuildResponse<T>> type,
        String path) {
        String body = response == null ? null : JSON.toJSONString(response.getData());
        if (response == null) {
            throw new BaseException("调用 Python 构建服务失败，响应为空: " + path);
        }
        if (!response.isSuccess()) {
            throw new BaseException(
                String.format("调用 Python 构建服务失败: %s, status=%s, body=%s", path, response.getStatusCode(), body));
        }
        if (type != null && type.getType() != null && type.getType().getTypeName().contains("java.lang.Void")) {
            JSONObject bodyJson = JSON.parseObject(body);
            PythonBuildResponse<T> parsed = new PythonBuildResponse<>();
            if (bodyJson != null) {
                parsed.setResultCode(bodyJson.getString("resultCode"));
                parsed.setResultMsg(bodyJson.getString("resultMsg"));
                parsed.setResultObject(null);
            }
            return parsed;
        }
        return JSON.parseObject(body, type);
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

    /**
     * 文件上传请求头
     *
     * @return Map
     */
    private Map<String, String> buildUploadHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "multipart/form-data");
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

    /**
     * 根据请求体中的 knCode 解析本次知识库调用路由。
     */
    private KnowledgeServiceEndpoint resolveRoute(Object payload) {
        return knowledgeServiceEndpointResolver.resolveByKnCode(extractKnCode(payload));
    }

    /**
     * 根据统一 operationId 解析本次知识库调用应使用的 path。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    private String resolvePath(Object payload, KnowledgeServiceOperation operation) {
        return knowledgeServicePathResolver.resolveByKnCodeAndOperation(extractKnCode(payload), operation);
    }

    /**
     * 通过反射兼容提取各知识库请求体中的 knCode 字段。
     */
    private String extractKnCode(Object payload) {
        if (payload == null) {
            return null;
        }
        try {
            Method method = payload.getClass().getMethod("getKnCode");
            Object value = method.invoke(payload);
            return value == null ? null : String.valueOf(value);
        }
        catch (Exception e) {
            return null;
        }
    }

    /**
     * 第三方知识库模式下的 JSON 直连 POST。
     */
    private <T> PythonBuildResponse<T> directPost(String baseUrl, String path, Object payload,
        TypeReference<PythonBuildResponse<T>> type) {
        String requestUrl = concatUrl(baseUrl, path);
        RequestBody requestBody = RequestBody.create(JSON.toJSONString(payload), JSON_MEDIA_TYPE);
        Request.Builder builder = new Request.Builder().url(requestUrl).post(requestBody);
        buildHeaders().forEach(builder::addHeader);
        try (Response response = OkHttpUtil.getHttpClient().newCall(builder.build()).execute()) {
            return parseDirectResponse(response, type, path);
        }
        catch (IOException e) {
            throw new BaseException("调用第三方知识库服务失败: " + path, e);
        }
    }

    /**
     * 第三方知识库模式下的 multipart 文件上传。
     */
    private <T> PythonBuildResponse<T> directUpload(String baseUrl, String path, String fileName,
        MultipartFile multipartFile, Map<String, String> formFields, TypeReference<PythonBuildResponse<T>> type) {
        String requestUrl = concatUrl(baseUrl, path);
        MultipartBody.Builder bodyBuilder = new MultipartBody.Builder().setType(MultipartBody.FORM);
        formFields.forEach(bodyBuilder::addFormDataPart);
        try {
            bodyBuilder.addFormDataPart("fileContent", fileName,
                RequestBody.create(multipartFile.getBytes(), MediaType.parse(multipartFile.getContentType())));
        }
        catch (IOException e) {
            throw new BaseException("读取上传文件失败", e);
        }

        Request.Builder builder = new Request.Builder().url(requestUrl).post(bodyBuilder.build());
        buildAuthHeaders().forEach(builder::addHeader);
        try (Response response = OkHttpUtil.getHttpClient().newCall(builder.build()).execute()) {
            return parseDirectResponse(response, type, path);
        }
        catch (IOException e) {
            throw new BaseException("调用第三方知识库上传服务失败: " + path, e);
        }
    }

    /**
     * 第三方知识库模式下的文件流下载。
     */
    private InputStream directDownload(String baseUrl, String path, Object payload) {
        String requestUrl = concatUrl(baseUrl, path);
        RequestBody requestBody = RequestBody.create(JSON.toJSONString(payload), JSON_MEDIA_TYPE);
        Request.Builder builder = new Request.Builder().url(requestUrl).post(requestBody);
        buildHeaders().forEach(builder::addHeader);
        try (Response response = OkHttpUtil.getHttpClient().newCall(builder.build()).execute()) {
            if (!response.isSuccessful()) {
                throw new BaseException("调用第三方知识库下载接口失败: " + path + ", status=" + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new BaseException("调用第三方知识库下载接口失败，响应体为空: " + path);
            }
            return new ByteArrayInputStream(body.bytes());
        }
        catch (IOException e) {
            throw new BaseException("调用第三方知识库下载接口失败", e);
        }
    }

    /**
     * 构造第三方 multipart 上传用的认证请求头。
     */
    private Map<String, String> buildAuthHeaders() {
        Map<String, String> headers = new HashMap<>();
        return addAuth(headers);
    }

    /**
     * 解析第三方直连返回的统一响应体。
     */
    private <T> PythonBuildResponse<T> parseDirectResponse(Response response,
        TypeReference<PythonBuildResponse<T>> type, String path) throws IOException {
        if (response == null) {
            throw new BaseException("调用第三方知识库服务失败，响应为空: " + path);
        }
        ResponseBody responseBody = response.body();
        String body = responseBody == null ? null : responseBody.string();
        if (!response.isSuccessful()) {
            throw new BaseException(String.format("调用第三方知识库服务失败: %s, status=%s, body=%s", path, response.code(), body));
        }
        if (type != null && type.getType() != null && type.getType().getTypeName().contains("java.lang.Void")) {
            JSONObject bodyJson = JSON.parseObject(body);
            PythonBuildResponse<T> parsed = new PythonBuildResponse<>();
            if (bodyJson != null) {
                parsed.setResultCode(bodyJson.getString("resultCode"));
                parsed.setResultMsg(bodyJson.getString("resultMsg"));
                parsed.setResultObject(null);
            }
            return parsed;
        }
        return JSON.parseObject(body, type);
    }

    /**
     * 安全拼接第三方知识库基础地址和接口路径。
     */
    private String concatUrl(String baseUrl, String path) {
        if (StringUtil.isEmpty(baseUrl)) {
            return path;
        }
        if (StringUtil.isEmpty(path)) {
            return baseUrl;
        }
        if (baseUrl.endsWith("/") && path.startsWith("/")) {
            return baseUrl.substring(0, baseUrl.length() - 1) + path;
        }
        if (!baseUrl.endsWith("/") && !path.startsWith("/")) {
            return baseUrl + "/" + path;
        }
        return baseUrl + path;
    }
}
