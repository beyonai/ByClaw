package com.iwhalecloud.byai.common.feign.client;

import java.io.InputStream;
import java.io.SequenceInputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import com.alibaba.fastjson.JSON;
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
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.FileBuildStatus;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbBuildResult;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbGlob;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.FileToMarkdownResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileMetadataGet;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileRead;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemReferences;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemsMove;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDelete;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileReadResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileUpdateResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileMetadataResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBaseInfo;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBuildResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemReferencesResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemsMoveResult;
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

    private static final int MAX_DOWNLOAD_ERROR_BODY_BYTES = 64 * 1024;

    static final String RESOURCE_ID_HEADER = "X-Byclaw-Resource-Id";

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
        return deleteKnowledgeBase(kbKnowledgeDelete, null);
    }

    public PythonBuildResponse<Void> deleteKnowledgeBase(KbKnowledgeDelete kbKnowledgeDelete, Long resourceId) {
        return post(KnowledgeServiceOperation.DELETE_KB, kbKnowledgeDelete,
            new TypeReference<PythonBuildResponse<Void>>() {
            }, resourceId);
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
        return createDirectory(kbDirectoryCreate, null);
    }

    public PythonBuildResponse<Void> createDirectory(KbDirectoryCreate kbDirectoryCreate, Long resourceId) {
        return post(KnowledgeServiceOperation.CREATE_DIR, kbDirectoryCreate,
            new TypeReference<PythonBuildResponse<Void>>() {
            }, resourceId);
    }

    /**
     * 删除目录。
     *
     * @param kbDirectoryDelete knCode、directoryPath
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> deleteDirectory(KbDirectoryDelete kbDirectoryDelete) {
        return deleteDirectory(kbDirectoryDelete, null);
    }

    public PythonBuildResponse<Void> deleteDirectory(KbDirectoryDelete kbDirectoryDelete, Long resourceId) {
        return post(KnowledgeServiceOperation.DELETE_DIR, kbDirectoryDelete,
            new TypeReference<PythonBuildResponse<Void>>() {
            }, resourceId);
    }

    /**
     * 重命名目录最后一级。
     *
     * @param kbDirectoryUpdate knCode、原路径、新目录名
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> updateDirectory(KbDirectoryUpdate kbDirectoryUpdate) {
        return updateDirectory(kbDirectoryUpdate, null);
    }

    public PythonBuildResponse<Void> updateDirectory(KbDirectoryUpdate kbDirectoryUpdate, Long resourceId) {
        return post(KnowledgeServiceOperation.EDIT_DIR, kbDirectoryUpdate,
            new TypeReference<PythonBuildResponse<Void>>() {
            }, resourceId);
    }

    /**
     * 列出目录或者文件
     *
     * @param kbListDir 列出文件
     * @return PythonBuildResponse<DirOrFile>
     */
    public PythonBuildResponse<Data> listDir(KbListDir kbListDir) {
        return listDir(kbListDir, null);
    }

    public PythonBuildResponse<Data> listDir(KbListDir kbListDir, Long resourceId) {
        return post(KnowledgeServiceOperation.LIST_DIR, kbListDir, new TypeReference<PythonBuildResponse<Data>>() {
        }, resourceId);
    }

    /**
     * 按 QA glob 规则匹配知识库文件或目录。
     */
    public PythonBuildResponse<Data> glob(KbGlob request) {
        return glob(request, null);
    }

    public PythonBuildResponse<Data> glob(KbGlob request, Long resourceId) {
        return post(KnowledgeServiceOperation.GLOB, request, new TypeReference<PythonBuildResponse<Data>>() {
        }, resourceId);
    }

    /**
     * 导入文件到知识库（multipart/form-data）。
     *
     * @param kbFileImport 导入参数
     * @return 成功时含 KbImportResult
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<KbImportResult> importKnowledgeItem(KbFileImport kbFileImport) {
        return importKnowledgeItem(kbFileImport, null);
    }

    public PythonBuildResponse<KbImportResult> importKnowledgeItem(KbFileImport kbFileImport, Long resourceId) {
        try {

            // 文件信息
            MultipartFile multipartFile = kbFileImport.getMultipartFile();
            String originalFilename = multipartFile.getOriginalFilename();
            ByHttpClient.InputStreamSupplier streamSupplier = () -> multipartFile.getInputStream();

            // 表单参数
            Map<String, String> formFields = new HashMap<>();
            formFields.put("knCode", kbFileImport.getKnCode());
            formFields.put("filePath", kbFileImport.getFilePath());
            if (kbFileImport.getFileDescription() != null) {
                formFields.put("fileDescription", kbFileImport.getFileDescription());
            }
            if (kbFileImport.getProcessFrontMatter() != null) {
                formFields.put("processFrontMatter", String.valueOf(kbFileImport.getProcessFrontMatter()));
            }

            String requestPath = resolvePath(kbFileImport, KnowledgeServiceOperation.UPLOAD_FILE);
            KnowledgeServiceEndpoint endpoint = resolveRoute(kbFileImport);
            if (endpoint.isDirectUrl()) {
                return directUpload(endpoint.getBaseUrl(), requestPath, originalFilename, multipartFile, formFields,
                    new TypeReference<PythonBuildResponse<KbImportResult>>() {
                    });
            }
            HttpResponse httpResponse = discoveryHttpClient.upload(endpoint.getServiceName(), requestPath,
                originalFilename, "fileContent", streamSupplier, this.buildUploadHeaders(resourceId), formFields).get();

            return this.parseResponse(httpResponse, new TypeReference<PythonBuildResponse<KbImportResult>>() {
            }, requestPath);
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("调用 Python 构建服务失败: ", e);
        }
    }

    /**
     * 更新已存在知识库文档（multipart/form-data）。更新不会自动触发知识构建。
     *
     * @param kbFileUpdate 更新参数
     * @return 成功时含单文件更新结果
     */
    public PythonBuildResponse<KbFileUpdateResult> updateKnowledgeItem(KbFileUpdate kbFileUpdate) {
        return updateKnowledgeItem(kbFileUpdate, null);
    }

    public PythonBuildResponse<KbFileUpdateResult> updateKnowledgeItem(KbFileUpdate kbFileUpdate, Long resourceId) {
        try {
            MultipartFile multipartFile = kbFileUpdate.getMultipartFile();
            String originalFilename = multipartFile.getOriginalFilename();
            ByHttpClient.InputStreamSupplier streamSupplier = () -> multipartFile.getInputStream();

            Map<String, String> formFields = new HashMap<>();
            formFields.put("knCode", kbFileUpdate.getKnCode());
            formFields.put("filePath", kbFileUpdate.getFilePath());
            if (kbFileUpdate.getFileDescription() != null) {
                formFields.put("fileDescription", kbFileUpdate.getFileDescription());
            }
            if (kbFileUpdate.getProcessFrontMatter() != null) {
                formFields.put("processFrontMatter", String.valueOf(kbFileUpdate.getProcessFrontMatter()));
            }

            String requestPath = resolvePath(kbFileUpdate, KnowledgeServiceOperation.UPDATE_FILE);
            KnowledgeServiceEndpoint endpoint = resolveRoute(kbFileUpdate);
            if (endpoint.isDirectUrl()) {
                return directUpload(endpoint.getBaseUrl(), requestPath, originalFilename, multipartFile, formFields,
                    new TypeReference<PythonBuildResponse<KbFileUpdateResult>>() {
                    });
            }
            HttpResponse httpResponse = discoveryHttpClient.upload(endpoint.getServiceName(), requestPath,
                originalFilename, "fileContent", streamSupplier, this.buildUploadHeaders(resourceId), formFields).get();
            return this.parseResponse(httpResponse, new TypeReference<PythonBuildResponse<KbFileUpdateResult>>() {
            }, requestPath);
        }
        catch (BaseException e) {
            throw e;
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
        return deleteKnowledgeItem(temDelete, null);
    }

    public PythonBuildResponse<Void> deleteKnowledgeItem(KbFileDelete temDelete, Long resourceId) {
        return post(KnowledgeServiceOperation.DELETE_FILE, temDelete, new TypeReference<PythonBuildResponse<Void>>() {
        }, resourceId);
    }

    /**
     * 读取知识库文件 Markdown 内容。
     *
     * @param kbFileRead 读取条件
     * @return 文件内容
     */
    public PythonBuildResponse<KbFileReadResult> readFile(KbFileRead kbFileRead) {
        return readFile(kbFileRead, null);
    }

    public PythonBuildResponse<KbFileReadResult> readFile(KbFileRead kbFileRead, Long resourceId) {
        return post(KnowledgeServiceOperation.READ_FILE, kbFileRead,
            new TypeReference<PythonBuildResponse<KbFileReadResult>>() {
            }, resourceId);
    }

    /**
     * 查询知识库文件完整构建结果。
     */
    public PythonBuildResponse<KnowledgeBuildResult> buildResult(KbBuildResult request, Long resourceId) {
        return post(KnowledgeServiceOperation.BUILD_RESULT, request,
            new TypeReference<PythonBuildResponse<KnowledgeBuildResult>>() {
            }, resourceId);
    }

    /**
     * 查询指定知识库文件当前已入库的元数据。
     */
    public PythonBuildResponse<KbFileMetadataResult> getKnowledgeFileMetadata(KbFileMetadataGet request) {
        return getKnowledgeFileMetadata(request, null);
    }

    public PythonBuildResponse<KbFileMetadataResult> getKnowledgeFileMetadata(KbFileMetadataGet request,
        Long resourceId) {
        return post(KnowledgeServiceOperation.GET_FILE_METADATA, request,
            new TypeReference<PythonBuildResponse<KbFileMetadataResult>>() {
            }, resourceId);
    }

    /**
     * 批量移动知识库文件或目录。
     *
     * @param request 移动条件
     * @return 各源路径的移动结果与汇总
     */
    public PythonBuildResponse<KnowledgeItemsMoveResult> moveKnowledgeItems(KbKnowledgeItemsMove request) {
        return moveKnowledgeItems(request, null);
    }

    public PythonBuildResponse<KnowledgeItemsMoveResult> moveKnowledgeItems(KbKnowledgeItemsMove request,
        Long resourceId) {
        return post(KnowledgeServiceOperation.MOVE_KNOWLEDGE_ITEMS, request,
            new TypeReference<PythonBuildResponse<KnowledgeItemsMoveResult>>() {
            }, resourceId);
    }

    /**
     * 查询 Markdown 文件的入站、出站引用关系。
     */
    public PythonBuildResponse<KnowledgeItemReferencesResult> knowledgeItemReferences(
        KbKnowledgeItemReferences request) {
        return knowledgeItemReferences(request, null);
    }

    public PythonBuildResponse<KnowledgeItemReferencesResult> knowledgeItemReferences(
        KbKnowledgeItemReferences request, Long resourceId) {
        return post(KnowledgeServiceOperation.KNOWLEDGE_ITEM_REFERENCES, request,
            new TypeReference<PythonBuildResponse<KnowledgeItemReferencesResult>>() {
            }, resourceId);
    }

    /**
     * 执行知识库 chunk 检索。
     *
     * @param kbKnowledgeSearch 检索条件
     * @return 检索结果
     */
    public PythonBuildResponse<KnowledgeSearchResult> searchKnowledgeItems(KbKnowledgeSearch kbKnowledgeSearch) {
        return post(KnowledgeServiceOperation.KNOWLEDGE_SEARCH, kbKnowledgeSearch,
            new TypeReference<PythonBuildResponse<KnowledgeSearchResult>>() {
            });
    }

    /**
     * 执行知识库 Agent DSL 文件级语义检索。
     *
     * @param kbKnowledgeFileSearch 检索条件
     * @return 文件级检索结果
     */
    public PythonBuildResponse<KnowledgeFileSearchResult> searchKnowledgeFiles(
        KbKnowledgeFileSearch kbKnowledgeFileSearch) {
        return post(KnowledgeServiceOperation.KNOWLEDGE_FILE_SEARCH, kbKnowledgeFileSearch,
            new TypeReference<PythonBuildResponse<KnowledgeFileSearchResult>>() {
            });
    }

    /**
     * 上传原始文件并同步转换为 Markdown 文件流。
     *
     * @param multipartFile 原始文件
     * @return Markdown 文件流结果
     */
    public FileToMarkdownResult fileToMarkdown(MultipartFile multipartFile) {
        try {
            String requestPath = resolvePath(null, KnowledgeServiceOperation.FILE_TO_MARKDOWN);
            KnowledgeServiceEndpoint endpoint = resolveRoute(null);
            String baseUrl = endpoint.isDirectUrl() ? endpoint.getBaseUrl() : resolveDiscoveryBaseUrl(endpoint.getServiceName());
            return uploadFileToMarkdown(baseUrl, requestPath, multipartFile);
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("调用 Python 构建服务文件转Markdown接口失败", e);
        }
    }

    /**
     * 根据文件路径异步构建指定知识库下的文件，自动完成原始文件转 Markdown、切片和切片向量化处理。
     *
     * @param kbFileToMarkdownIndex 构建的文件信息
     * @return 统一响应
     * @throws BaseException 调用失败
     */
    public PythonBuildResponse<Void> fileToMarkdownIndex(KbFileToMarkdownIndex kbFileToMarkdownIndex) {
        return fileToMarkdownIndex(kbFileToMarkdownIndex, null);
    }

    public PythonBuildResponse<Void> fileToMarkdownIndex(KbFileToMarkdownIndex kbFileToMarkdownIndex,
        Long resourceId) {
        return post(KnowledgeServiceOperation.KNOWLEDGE_BUILD, kbFileToMarkdownIndex,
            new TypeReference<PythonBuildResponse<Void>>() {
            }, resourceId);
    }

    /**
     * 下载原始文件流
     *
     * @param kbFileDownload 文件下载信息
     * @return 文件流
     * @throws BaseException 调用失败
     */
    public InputStream fileDownload(KbFileDownload kbFileDownload) {
        return fileDownload(kbFileDownload, null);
    }

    public InputStream fileDownload(KbFileDownload kbFileDownload, Long resourceId) {
        return downloadKnowledgeFile(kbFileDownload, resourceId, KnowledgeServiceOperation.DOWNLOAD_FILE);
    }

    private InputStream downloadKnowledgeFile(KbFileDownload kbFileDownload, Long resourceId,
        KnowledgeServiceOperation operation) {
        try {
            String requestPath = resolvePath(kbFileDownload, operation);
            KnowledgeServiceEndpoint endpoint = resolveRoute(kbFileDownload);
            if (endpoint.isDirectUrl()) {
                return validateDownloadResponse(directDownload(endpoint.getBaseUrl(), requestPath, kbFileDownload),
                    requestPath);
            }
            CompletableFuture<InputStream> completableFuture = discoveryHttpClient.download("POST",
                endpoint.getServiceName(), requestPath, this.buildHeaders(resourceId), null, kbFileDownload, null);
            // 提取文件流
            return validateDownloadResponse(completableFuture.get(), requestPath);
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("调用 Python 构建服务文件流接口失败", e);
        }
    }

    /**
     * QA 下载失败时可能返回统一 JSON 信封。小响应先完整检查，避免将错误 JSON 当作文件流输出；
     * 大文件只缓存固定前缀后继续流式转发。
     */
    private InputStream validateDownloadResponse(InputStream inputStream, String requestPath) {
        if (inputStream == null) {
            throw new BaseException("调用 Python 构建服务下载接口失败，响应体为空: " + requestPath);
        }
        try {
            byte[] prefix = inputStream.readNBytes(MAX_DOWNLOAD_ERROR_BODY_BYTES + 1);
            if (prefix.length <= MAX_DOWNLOAD_ERROR_BODY_BYTES) {
                String body = new String(prefix, StandardCharsets.UTF_8).trim();
                if (body.startsWith("{") && body.endsWith("}")) {
                    JSONObject responseJson = null;
                    try {
                        responseJson = JSON.parseObject(body);
                    }
                    catch (RuntimeException parseException) {
                        logger.debug("知识库下载内容不是统一 JSON 响应: {}", requestPath, parseException);
                    }
                    String resultCode = responseJson == null ? null : responseJson.getString("resultCode");
                    if (resultCode != null && !PythonBuildResponse.RESPONSE_SUCCESS.equals(resultCode)) {
                        inputStream.close();
                        String resultMsg = responseJson.getString("resultMsg");
                        throw new BaseException(StringUtil.isEmpty(resultMsg)
                            ? "调用 Python 构建服务下载接口失败: " + requestPath : resultMsg);
                    }
                }
                inputStream.close();
                return new ByteArrayInputStream(prefix);
            }
            return new SequenceInputStream(new ByteArrayInputStream(prefix), inputStream);
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            try {
                inputStream.close();
            }
            catch (IOException closeException) {
                logger.debug("关闭知识库下载流失败: {}", requestPath, closeException);
            }
            throw new BaseException("校验 Python 构建服务下载响应失败: " + requestPath, e);
        }
    }

    /**
     * 文件构建
     *
     * @param fileBuildStatus 入参
     * @return PythonBuildResponse
     */
    public PythonBuildResponse<ProcessStatus> fileBuildStatus(FileBuildStatus fileBuildStatus) {
        return fileBuildStatus(fileBuildStatus, null);
    }

    public PythonBuildResponse<ProcessStatus> fileBuildStatus(FileBuildStatus fileBuildStatus, Long resourceId) {
        return post(KnowledgeServiceOperation.FILE_BUILD_STATUS, fileBuildStatus,
            new TypeReference<PythonBuildResponse<ProcessStatus>>() {
            }, resourceId);
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
        return post(operation, payload, type, (Long)null);
    }

    private <T> PythonBuildResponse<T> post(KnowledgeServiceOperation operation, Object payload,
        TypeReference<PythonBuildResponse<T>> type, Long resourceId) {
        try {
            return doPost(operation, payload, type, resourceId);
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
            return doPost(operation, payload, type, null);
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
        TypeReference<PythonBuildResponse<T>> type, Long resourceId) throws Exception {
        String requestPath = resolvePath(payload, operation);
        KnowledgeServiceEndpoint endpoint = resolveRoute(payload);
        if (endpoint.isDirectUrl()) {
            return directPost(endpoint.getBaseUrl(), requestPath, payload, type);
        }
        HttpResponse response = discoveryHttpClient
            .post(endpoint.getServiceName(), requestPath, buildHeaders(resourceId), payload, null)
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
        return buildHeaders(null);
    }

    private Map<String, String> buildHeaders(Long resourceId) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        return this.addResourceContext(this.addAuth(headers), resourceId);
    }

    /**
     * 文件上传请求头
     *
     * @return Map
     */
    private Map<String, String> buildUploadHeaders() {
        return buildUploadHeaders(null);
    }

    private Map<String, String> buildUploadHeaders(Long resourceId) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "multipart/form-data");
        return this.addResourceContext(this.addAuth(headers), resourceId);
    }

    private Map<String, String> addResourceContext(Map<String, String> headers, Long resourceId) {
        if (resourceId != null) {
            headers.put(RESOURCE_ID_HEADER, String.valueOf(resourceId));
        }
        return headers;
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
                ResponseBody errorBody = response.body();
                String errorText = errorBody == null ? null : errorBody.string();
                String resultMsg = extractQaResultMessage(errorText);
                throw new BaseException(StringUtil.isEmpty(resultMsg)
                    ? "调用第三方知识库下载接口失败: " + path + ", status=" + response.code() : resultMsg);
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

    private String extractQaResultMessage(String responseBody) {
        if (StringUtil.isEmpty(responseBody)) {
            return null;
        }
        try {
            JSONObject responseJson = JSON.parseObject(responseBody);
            return responseJson == null ? null : responseJson.getString("resultMsg");
        }
        catch (RuntimeException e) {
            return null;
        }
    }

    private FileToMarkdownResult uploadFileToMarkdown(String baseUrl, String path, MultipartFile multipartFile) {
        if (multipartFile == null || multipartFile.isEmpty()) {
            throw new BaseException("待转换文件不能为空");
        }
        String requestUrl = concatUrl(baseUrl, path);
        String originalFilename = multipartFile.getOriginalFilename();
        String contentType = StringUtil.isEmpty(multipartFile.getContentType()) ? "application/octet-stream"
            : multipartFile.getContentType();
        MultipartBody.Builder bodyBuilder = new MultipartBody.Builder().setType(MultipartBody.FORM);
        try {
            bodyBuilder.addFormDataPart("fileContent", originalFilename,
                RequestBody.create(multipartFile.getBytes(), MediaType.parse(contentType)));
        }
        catch (IOException e) {
            throw new BaseException("读取待转换文件失败", e);
        }

        Request.Builder builder = new Request.Builder().url(requestUrl).post(bodyBuilder.build());
        buildAuthHeaders().forEach(builder::addHeader);
        try (Response response = OkHttpUtil.getHttpClient().newCall(builder.build()).execute()) {
            ResponseBody body = response.body();
            byte[] bytes = body == null ? new byte[0] : body.bytes();
            if (!response.isSuccessful()) {
                String errorBody = new String(bytes, StandardCharsets.UTF_8);
                throw new BaseException(
                    String.format("调用 Python 构建服务文件转Markdown接口失败: %s, status=%s, body=%s", path,
                        response.code(), errorBody));
            }
            if (bytes.length == 0) {
                throw new BaseException("调用 Python 构建服务文件转Markdown接口失败，响应体为空: " + path);
            }
            String markdownFileName = resolveMarkdownFileName(response.header("Content-Disposition"), originalFilename);
            String responseContentType = StringUtil.isEmpty(response.header("Content-Type"))
                ? "application/octet-stream"
                : response.header("Content-Type");
            return new FileToMarkdownResult(markdownFileName, responseContentType, bytes);
        }
        catch (IOException e) {
            throw new BaseException("调用 Python 构建服务文件转Markdown接口失败", e);
        }
    }

    private String resolveDiscoveryBaseUrl(String serviceName) {
        Optional<ServiceInstance> instance = discoveryClient.discover(serviceName);
        if (instance.isEmpty()) {
            throw new BaseException("未找到 Python 构建服务实例: " + serviceName);
        }
        ServiceInstance serviceInstance = instance.get();
        String protocol = serviceInstance.getProtocol() == null ? "http" : serviceInstance.getProtocol();
        String pathPrefix = StringUtil.isEmpty(serviceInstance.getPathPrefix()) ? "" : serviceInstance.getPathPrefix();
        return protocol + "://" + serviceInstance.getHost() + ":" + serviceInstance.getPort() + pathPrefix;
    }

    private String resolveMarkdownFileName(String contentDisposition, String originalFilename) {
        String filename = extractFilenameFromContentDisposition(contentDisposition);
        if (!StringUtil.isEmpty(filename)) {
            return filename;
        }
        return buildMarkdownFileName(originalFilename);
    }

    private String extractFilenameFromContentDisposition(String contentDisposition) {
        if (StringUtil.isEmpty(contentDisposition)) {
            return null;
        }
        String[] parts = contentDisposition.split(";");
        for (String part : parts) {
            String trimmed = part == null ? "" : part.trim();
            if (trimmed.startsWith("filename*=")) {
                String value = trimmed.substring("filename*=".length()).trim();
                int charsetPrefixIndex = value.indexOf("''");
                if (charsetPrefixIndex >= 0) {
                    value = value.substring(charsetPrefixIndex + 2);
                }
                return decodeHeaderFilename(stripQuotes(value));
            }
        }
        for (String part : parts) {
            String trimmed = part == null ? "" : part.trim();
            if (trimmed.startsWith("filename=")) {
                return decodeHeaderFilename(stripQuotes(trimmed.substring("filename=".length()).trim()));
            }
        }
        return null;
    }

    private String decodeHeaderFilename(String value) {
        if (StringUtil.isEmpty(value)) {
            return null;
        }
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private String stripQuotes(String value) {
        if (value == null || value.length() < 2) {
            return value;
        }
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private String buildMarkdownFileName(String originalFilename) {
        String fileName = StringUtil.isEmpty(originalFilename) ? "converted" : originalFilename;
        fileName = fileName.replace('\\', '/');
        int slashIndex = fileName.lastIndexOf('/');
        if (slashIndex >= 0) {
            fileName = fileName.substring(slashIndex + 1);
        }
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0) {
            fileName = fileName.substring(0, dotIndex);
        }
        if (StringUtil.isEmpty(fileName)) {
            fileName = "converted";
        }
        return fileName + ".md";
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
