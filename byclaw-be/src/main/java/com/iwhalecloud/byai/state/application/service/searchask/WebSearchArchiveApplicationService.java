package com.iwhalecloud.byai.state.application.service.searchask;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDir;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDirRel;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirMapper;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirRelMapper;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDataType;
import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlArchiveDoc;
import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlRequest;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.searchask.WebCrawlDocArchiveMapper;
import com.iwhalecloud.byai.manager.mapper.searchask.WebCrawlRequestMapper;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDirType;
import com.iwhalecloud.byai.common.constants.searchask.WebCrawlStatusType;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.searchask.vo.ArchiveSelectedDocVO;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.searchask.dto.WebCrawlFetchResultDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.WebSearchDocDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.ArchiveSelectedDocDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.WebCrawlArchiveDocDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.SessionArchiveItemDTO;
import com.iwhalecloud.byai.state.domain.searchask.vo.SessionSelectDocVO;
import com.iwhalecloud.byai.state.domain.searchask.vo.WebSearchQueryVO;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.feign.client.FeignDocChainService;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;

/**
 * 联网搜索归档应用服务：调用 DocChain 搜索，爬取 URL 转 Markdown 上传 MinIO 并落库，写入 web_crawl_request / web_crawl_doc_archive。
 *
 * @author system
 */
@Service
public class WebSearchArchiveApplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(WebSearchArchiveApplicationService.class);

    private static final String TEXT_KEY = "text";

    private static final String CHUNK_DATA_KEY = "data";

    private static final String HEADING_CHAIN_KEY = "heading_chain";

    private static final String CONTENT_KEY = "content";

    private static final String URL_KEY = "url";

    private static final String SCORE_KEY = "score";

    private static final int DEFAULT_SIZE = 10;

    private static final String DEFAULT_TOPIC_ID = "394";

    @Autowired
    private FeignDocChainService feignDocChainService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private WebCrawlRequestMapper webCrawlRequestMapper;

    @Autowired
    private WebCrawlDocArchiveMapper webCrawlDocArchiveMapper;

    @Autowired
    private WebCrawlFetchService webCrawlFetchService;

    @Autowired
    private HtmlToMarkdownService htmlToMarkdownService;

    @Autowired
    private FileIngressService fileIngressService;

    @Autowired
    private FilesMapper filesMapper;

    @Autowired
    private SpaceDirMapper spaceDirMapper;

    @Autowired
    private SpaceDirRelMapper spaceDirRelMapper;

    @Autowired
    private SessionService sessionService;

    /** 父目录名称：用户导入来源 */
    private static final String PARENT_DIR_NAME = "用户导入来源";

    /** 子目录名称：联网搜索 */
    private static final String WEB_SEARCH_DIR_NAME = "联网搜索";

    /**
     * 执行联网搜索：生成 request_id，调用 DocChain 获取 textList，写入请求表并返回请求记录与文本列表。 前端可基于 textList 展示并勾选，再调用 {@link #archiveSelected}
     * 对选中项进行爬取→MD→上传→落库。
     *
     * @param request 归档请求（query 必填，sessionId/topicId/size 可选）
     * @return 本次请求的 requestId 与 DocChain 文本列表（封装为 VO）
     */
    @Transactional(rollbackFor = Exception.class)
    public WebSearchQueryVO query(WebSearchDocDTO request) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        // 统一处理会话：sessionId 为空或不存在时创建新会话
        Long sessionId = ensureSessionExists(request.getSessionId(), userId);
        request.setSessionId(sessionId);

        Map<String, Object> params = new HashMap<>();
        params.put("query", request.getQuery());
        params.put("topic_id", StringUtils.isNotBlank(request.getTopicId()) ? request.getTopicId() : DEFAULT_TOPIC_ID);
        params.put("size", request.getSize() != null && request.getSize() > 0 ? request.getSize() : DEFAULT_SIZE);

        List<Map<String, Object>> textList = parseTextResultsFromDocChain(params);
        if (textList == null) {
            textList = new ArrayList<>();
        }

        WebCrawlRequest req = new WebCrawlRequest();
        Long requestId = sequenceService.nextVal();
        req.setRequestId(requestId);
        req.setSessionId(sessionId);
        req.setQuery(request.getQuery());
        req.setCreateTime(new Date());
        req.setCreateBy(userId);
        webCrawlRequestMapper.insert(req);

        return new WebSearchQueryVO(sessionId, requestId, textList);
    }

    /**
     * 对指定 requestId 下用户选中的 textList 条目执行爬取→MD→上传→落库，写入 web_crawl_doc_archive。 同一事务：先批量插入 byai_files，再批量插入
     * web_crawl_doc_archive，任一步异常则整体回滚。
     *
     * @param archiveRequest 选中归档请求（requestId、catalogId、sessionId、选中的 textList）
     * @return 归档结果（requestId、query、docList）
     */
    @Transactional(rollbackFor = Exception.class)
    public ArchiveSelectedDocVO archiveSelected(ArchiveSelectedDocDTO archiveRequest) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        // 统一处理会话：为空或不存在时创建新会话
        Long sessionId = ensureSessionExists(archiveRequest.getSessionId(), userId);
        archiveRequest.setSessionId(sessionId);

        // 确保两个目录存在：用户导入来源（父）→ 联网搜索（子），返回联网搜索目录 ID 用于关联
        Long webSearchDirId = ensureWebSearchDirectories(sessionId);

        Long requestId = archiveRequest.getRequestId();
        List<Map<String, Object>> selectedList = archiveRequest.getTextList() != null ? archiveRequest.getTextList()
            : new ArrayList<>();

        // 解析url爬取文本md存储文件，返回文件信息
        List<Files> filesToInsert = new ArrayList<>();
        List<WebCrawlArchiveDocDTO> docDtoList = new ArrayList<>();
        for (Map<String, Object> item : selectedList) {
            WebCrawlArchiveDocDTO dto = processOneTextResult(item, requestId, sessionId, userId, filesToInsert);
            docDtoList.add(dto);
        }

        // md文件导入
        if (!filesToInsert.isEmpty()) {
            filesMapper.insertBatch(filesToInsert);
        }

        // 文档导入
        List<WebCrawlArchiveDoc> archiveList = toArchiveDocList(docDtoList);
        if (!archiveList.isEmpty()) {
            webCrawlDocArchiveMapper.insertBatch(archiveList);
        }

        // 将本次归档文档列表（含 fileUrl）序列化为 JSON 存入目录关联表扩展字段，供后续使用
        SpaceDirRel spaceDirRel = new SpaceDirRel();
        spaceDirRel.setDirRelId(sequenceService.nextVal());
        spaceDirRel.setDirId(webSearchDirId);
        spaceDirRel.setDataId(requestId);
        spaceDirRel.setDataType(SpaceDataType.DATA_TYPE_REQUEST);
        spaceDirRel.setExtJson(JSON.toJSONString(docDtoList));
        spaceDirRelMapper.insert(spaceDirRel);

        return new ArchiveSelectedDocVO(sessionId, docDtoList);
    }

    /**
     * 根据 sessionId 反查该会话下所有归档请求的 request_id、query，以及每条请求下的文档列表； 对每条文档的 minio_file_id 反查 byai_files 得到
     * fileName、fileUrl、contentType。
     *
     * @param sessionId 会话标识，必填
     * @return 该 session 下所有 request 的 query 与文档列表及文件信息
     */
    public SessionSelectDocVO listBySessionId(Long sessionId) {
        List<WebCrawlRequest> requests = webCrawlRequestMapper.listBySessionId(sessionId);
        List<SessionArchiveItemDTO> requestList = new ArrayList<>();
        if (requests == null) {
            return new SessionSelectDocVO(sessionId, requestList);
        }
        for (WebCrawlRequest req : requests) {
            List<WebCrawlArchiveDoc> docs = webCrawlDocArchiveMapper.listByRequestId(req.getRequestId());
            requestList.add(new SessionArchiveItemDTO(req.getRequestId(), req.getQuery(), req.getCreateTime(), docs));
        }
        return new SessionSelectDocVO(sessionId, requestList);
    }

    /**
     * 从 DocChain 响应中解析 data.text 列表（通过 feignDocChainService 获取列表 )
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseTextResultsFromDocChain(Map<String, Object> params) {
        Map<String, Object> response = null;
        try {
            response = feignDocChainService.search(params);
        }
        catch (Exception e) {
            throw new BdpRuntimeException(I18nUtil.get("web.search.doc.chain.error"));
        }
        if (response == null) {
            throw new BdpRuntimeException(I18nUtil.get("web.search.doc.chain.error"));
        }
        Object textObj = response.get(TEXT_KEY);
        if (!(textObj instanceof List)) {
            return null;
        }
        return (List<Map<String, Object>>) textObj;
    }

    /**
     * 处理单条 TextResult：取 title/url/content_snippet，有 url 则爬取→MD→上传，将 Files 加入 filesToInsert 列表（不在此处插入）， 构建
     * WebCrawlArchiveDocDTO（含 fileUrl 供前端/JSON 使用）并返回。
     */
    private WebCrawlArchiveDocDTO processOneTextResult(Map<String, Object> item, Long requestId, Long sessionId,
        Long createBy, List<Files> filesToInsert) {
        Map<String, Object> chunkData = getChunkDataMap(item);
        String title = getString(chunkData, HEADING_CHAIN_KEY);
        String sourceUrl = getString(chunkData, URL_KEY);
        String contentSnippet = getString(chunkData, CONTENT_KEY);

        Double score = getDouble(item, SCORE_KEY);
        if (score == null) {
            score = getDouble(chunkData, SCORE_KEY);
        }

        String crawlStatus = WebCrawlStatusType.FAILED;
        Long minioFileId = null;
        String fileUrl = null;
        String failureReason = null;
        if (StringUtils.isNotBlank(sourceUrl)) {
            WebCrawlFetchResultDTO fetchResult = webCrawlFetchService.fetch(sourceUrl);
            if (fetchResult.isSuccess() && StringUtils.isNotBlank(fetchResult.getHtml())) {
                try {
                    String markdown = htmlToMarkdownService.convertHtmlToMarkdown(fetchResult.getHtml());
                    String fileName = sanitizeFileName(title) + ".md";
                    MultipartFile multipartFile = webCrawlFetchService.markdownToMultipartFile(markdown, fileName);
                    try {
                        FileStorageContext context = FileStorageContext.searchFile(sessionId, requestId);
                        FileMetadata metadata = fileIngressService.uploadFile(multipartFile, context);
                        Long fileId = sequenceService.nextVal();
                        Files files = new Files();
                        files.setFileId(fileId);
                        files.setFileName(multipartFile.getName());
                        files.setContentType(multipartFile.getContentType());
                        files.setLength(multipartFile.getSize());
                        files.setFileUrl(metadata.getFileUrl());
                        files.setFileType("md");
                        files.setFileMd5(metadata.getFileMd5());
                        files.setFileSystemType(metadata.getStorageType());
                        files.setUploadDate(new Date());
                        files.setCreateBy(createBy);
                        filesToInsert.add(files);
                        minioFileId = fileId;
                        fileUrl = metadata.getFileUrl();
                        crawlStatus = WebCrawlStatusType.SUCCESS;
                    }
                    catch (Exception e) {
                        LOG.warn("上传或落库失败, requestId={}, url={}", requestId, maskUrl(sourceUrl), e);
                        failureReason = "web.crawl.fetch.upload.failed";
                    }
                }
                catch (BdpRuntimeException e) {
                    failureReason = e.getMessage();
                }
            }
            else {
                failureReason = fetchResult.getFailureReason();
            }
        }
        else {
            failureReason = "web.crawl.fetch.url.empty";
        }

        Long archiveId = sequenceService.nextVal();
        WebCrawlArchiveDocDTO dto = new WebCrawlArchiveDocDTO();
        dto.setDocArchiveId(archiveId);
        dto.setRequestId(requestId);
        dto.setTitle(title);
        dto.setSourceUrl(sourceUrl);
        dto.setContentSnippet(contentSnippet);
        dto.setStatus(crawlStatus);
        dto.setFileId(minioFileId);
        dto.setFileUrl(fileUrl);
        dto.setFailureReason(failureReason != null ? I18nUtil.get(failureReason) : null);
        dto.setScore(score);
        dto.setCreateTime(new Date());
        dto.setCreateBy(createBy);
        return dto;
    }

    /**
     * DTO 转实体列表：仅拷贝入库字段，不包含 fileUrl（实体表不存 fileUrl）。
     */
    private static List<WebCrawlArchiveDoc> toArchiveDocList(List<WebCrawlArchiveDocDTO> docDtoList) {
        if (docDtoList == null || docDtoList.isEmpty()) {
            return new ArrayList<>();
        }
        List<WebCrawlArchiveDoc> list = new ArrayList<>(docDtoList.size());
        for (WebCrawlArchiveDocDTO dto : docDtoList) {
            WebCrawlArchiveDoc doc = new WebCrawlArchiveDoc();
            BeanUtils.copyProperties(dto, doc);
            list.add(doc);
        }
        return list;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getChunkDataMap(Map<String, Object> item) {
        Object data = item.get(CHUNK_DATA_KEY);
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }
        return new HashMap<>();
    }

    private static String getString(Map<String, Object> map, String key) {
        if (map == null) {
            return null;
        }
        Object v = map.get(key);
        return v != null ? v.toString() : null;
    }

    private static Double getDouble(Map<String, Object> map, String key) {
        if (map == null) {
            return null;
        }
        Object v = map.get(key);
        if (v == null) {
            return null;
        }
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        try {
            return Double.parseDouble(v.toString());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private static String sanitizeFileName(String title) {
        String base = title != null ? title.replaceAll("[\\\\/:*?\"<>|]", "_") : "doc";
        if (base.length() > 200) {
            base = base.substring(0, 200);
        }
        return base;
    }

    private static String maskUrl(String url) {
        if (url == null || url.length() < 40) {
            return url;
        }
        return url.substring(0, 40) + "...";
    }

    /**
     * 统一处理会话：sessionId 为空或会话不存在时创建新会话并返回有效 sessionId。
     *
     * @param sessionId 前端传入的会话 ID，可为 null
     * @param userId 当前用户 ID
     * @return 有效的会话 ID（已存在或新创建）
     */
    private Long ensureSessionExists(Long sessionId, Long userId) {
        if (sessionId != null) {
            ByaiSession existing = sessionService.findById(sessionId);
            if (existing != null) {
                return sessionId;
            }
        }
        ByaiSession session = new ByaiSession();
        session.setSessionName("即时搜问-联网搜索:" + DateUtils.getFormatedDateTime(new Date()));
        session.setCreateTime(new Date());
        // session.setObjectType("");
        // session.setObjectId(0L);
        session.setSessionType(SessionType.H_S_A.getCode());
        session.setSessionId(sequenceService.nextVal());
        session.setIsDebug(0);
        session.setCreatorId(userId);
        session.setCreateTime(new Date());
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionService.save(session);
        return session.getSessionId();
    }

    /**
     * 确保当前会话下存在两个目录：用户导入来源（父）、联网搜索（子）。若不存在则创建，返回联网搜索目录的 dirId。
     *
     * @param sessionId 会话 ID
     * @return 联网搜索目录的 dirId，用于 spaceDirRel.dirId
     */
    private Long ensureWebSearchDirectories(Long sessionId) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        Date now = new Date();

        // 1. 获取或创建父目录：用户导入来源
        LambdaQueryWrapper<SpaceDir> parentWrapper = new LambdaQueryWrapper<>();
        parentWrapper.eq(SpaceDir::getSessionId, sessionId);
        parentWrapper.eq(SpaceDir::getDirType, SpaceDirType.DIR_TYPE_IMPORT);
        parentWrapper.eq(SpaceDir::getParentDirId, -1L);
        SpaceDir parentDir = spaceDirMapper.selectOne(parentWrapper);
        if (parentDir == null) {
            parentDir = new SpaceDir();
            parentDir.setDirId(sequenceService.nextVal());
            parentDir.setParentDirId(-1L);
            parentDir.setName(PARENT_DIR_NAME);
            parentDir.setDirType(SpaceDirType.DIR_TYPE_IMPORT);
            parentDir.setSessionId(sessionId);
            parentDir.setDescription(PARENT_DIR_NAME);
            parentDir.setCreateBy(userId);
            parentDir.setCreateTime(now);
            parentDir.setUpdateTime(now);
            parentDir.setSort(1);
            spaceDirMapper.insert(parentDir);
        }

        // 2. 获取或创建子目录：联网搜索
        LambdaQueryWrapper<SpaceDir> childWrapper = new LambdaQueryWrapper<>();
        childWrapper.eq(SpaceDir::getSessionId, sessionId);
        childWrapper.eq(SpaceDir::getDirType, SpaceDirType.DIR_TYPE_WEB_SEARCH);
        SpaceDir webSearchDir = spaceDirMapper.selectOne(childWrapper);
        if (webSearchDir == null) {
            webSearchDir = new SpaceDir();
            webSearchDir.setDirId(sequenceService.nextVal());
            webSearchDir.setParentDirId(parentDir.getDirId());
            webSearchDir.setName(WEB_SEARCH_DIR_NAME);
            webSearchDir.setDirType(SpaceDirType.DIR_TYPE_WEB_SEARCH);
            webSearchDir.setDescription(WEB_SEARCH_DIR_NAME);
            webSearchDir.setSessionId(sessionId);
            webSearchDir.setCreateBy(userId);
            webSearchDir.setCreateTime(now);
            webSearchDir.setUpdateTime(now);
            webSearchDir.setSort(2);
            spaceDirMapper.insert(webSearchDir);
        }
        return webSearchDir.getDirId();
    }
}
