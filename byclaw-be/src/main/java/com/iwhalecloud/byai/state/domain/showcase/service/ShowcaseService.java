package com.iwhalecloud.byai.state.domain.showcase.service;

import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.manager.mapper.showcase.ByaiShowcaseMapper;
import com.iwhalecloud.byai.manager.qo.showcase.ShowcaseQueryParam;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.showcase.ByaiShowcaseVo;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.common.dto.FileUploadDto;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import com.iwhalecloud.byai.state.domain.showcase.strategy.ShowcaseStrategy;
import com.iwhalecloud.byai.state.domain.showcase.strategy.ShowcaseStrategyFactory;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDownloadResult;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseCancelRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseCreateRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseQueryRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseUpdateRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.RebuildData;
import com.iwhalecloud.byai.common.log.exception.KnowledgeRuntimeExcepion;
import feign.Response;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 成果空间服务
 * <p>
 * 负责成果空间的增删改查操作，所有写操作均开启事务，确保跨库时的数据一致性。
 * </p>
 *
 * @author system
 * @date 2025-11-10
 */
@Slf4j
@Service
public class ShowcaseService {

    public static final Logger LOGGER = LoggerFactory.getLogger(ShowcaseService.class);

    private final ByaiShowcaseMapper byaiShowcaseMapper;

    private final SequenceService sequenceService;

    @Autowired
    private MessageService messageService;

    private final ShowcaseStrategyFactory showcaseStrategyFactory;

    @Autowired
    private FileService fileService;

    @Autowired
    @Lazy
    private ResourceApplicationService resourceApplicationService;

    public ShowcaseService(ByaiShowcaseMapper byaiShowcaseMapper, SequenceService sequenceService,
        ShowcaseStrategyFactory showcaseStrategyFactory) {
        this.byaiShowcaseMapper = byaiShowcaseMapper;
        this.sequenceService = sequenceService;
        this.showcaseStrategyFactory = showcaseStrategyFactory;
    }

    /**
     * 新增成果空间
     *
     * @return 生成的主键
     */
    @Transactional(rollbackFor = Exception.class)
    public Long createShowcase(ShowcaseCreateRequest request) {
        // 由于系统需兼容多种数据库，这里统一通过序列服务生成分布式唯一ID
        ByaiShowcase showcase = new ByaiShowcase();
        BeanUtils.copyProperties(request, showcase);

        showcase.setStatus(1);
        String sessionMode = resolveSessionMode(showcase.getType());
        showcase.setSessionMode(sessionMode);
        ShowcaseStrategy strategy = resolveStrategy(showcase.getType());
        strategy.beforeSave(showcase);

        if (showcase.isRecovered()) {
            return showcase.getId();
        }

        if (showcase.getId() == null) {
            showcase.setId(sequenceService.nextVal());
        }
        Date now = new Date();
        showcase.setCreateTime(now);
        showcase.setUpdateTime(now);
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        showcase.setCreateBy(currentUserId);
        showcase.setUpdateBy(currentUserId);
        showcase.setSessionMode(resolveSessionMode(showcase.getType()));
        log.info("新增成果空间，实体: {}", showcase);
        int insertCount = byaiShowcaseMapper.insert(showcase);
        if (insertCount < 1) {
            throw new IllegalStateException(I18nUtil.get("showcase.create.failed"));
        }
        return showcase.getId();
    }

    /**
     * 更新成果空间
     *
     * @return 是否更新成功
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean updateShowcase(ShowcaseUpdateRequest request) {
        Objects.requireNonNull(request, "showcase can not be null");
        Objects.requireNonNull(request.getId(), "成果空间主键不能为空");
        ByaiShowcase showcase = new ByaiShowcase();
        BeanUtils.copyProperties(request, showcase);
        ShowcaseStrategy strategy = resolveStrategy(showcase.getType());
        strategy.beforeUpdate(showcase);
        Date now = new Date();
        showcase.setUpdateTime(now);
        showcase.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        if (StringUtils.isNotBlank(showcase.getType())) {
            showcase.setSessionMode(resolveSessionMode(showcase.getType()));
        }
        log.info("更新成果空间，实体: {}", showcase);
        return byaiShowcaseMapper.updateById(showcase) > 0;
    }

    /**
     * 重命名成果空间
     *
     * @param id 主键
     * @param name 新名称
     * @return 是否更新成功
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean renameShowcase(Long id, String name) {
        Objects.requireNonNull(id, "成果空间主键不能为空");
        Objects.requireNonNull(name, "成果空间名称不能为空");
        if (StringUtils.isBlank(name)) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.name.not.empty"));
        }
        ByaiShowcase showcase = new ByaiShowcase();
        showcase.setId(id);
        showcase.setName(name);
        showcase.setUpdateTime(new Date());
        showcase.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        log.info("重命名成果空间 id={} name={}", id, name);
        return byaiShowcaseMapper.updateById(showcase) > 0;
    }

    /**
     * 根据主键删除成果空间
     *
     * @param id 主键
     * @return 是否删除成功
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteShowcase(Long id) {
        Objects.requireNonNull(id, "成果空间主键不能为空");
        ByaiShowcase showcase = new ByaiShowcase();
        showcase.setId(id);
        showcase.setStatus(0);
        showcase.setUpdateTime(new Date());
        showcase.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        log.info("逻辑删除成果空间，主键: {}", id);
        return byaiShowcaseMapper.updateById(showcase) > 0;
    }

    /**
     * 根据主键查询成果空间
     *
     * @param id 主键
     * @return 成果空间实体
     */
    public ByaiShowcase getShowcaseById(Long id) {
        Objects.requireNonNull(id, "成果空间主键不能为空");
        ByaiShowcase showcase = byaiShowcaseMapper.selectById(id);
        if (showcase == null) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.not.exist", id));
        }
        return showcase;
    }

    /**
     * 取消成果收藏，将状态标记为无效
     *
     * @param request 取消请求
     * @return 是否成功
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean cancelCollect(ShowcaseCancelRequest request) {
        Objects.requireNonNull(request, "取消收藏请求不能为空");
        Objects.requireNonNull(request.getSessionId(), "会话ID不能为空");
        Objects.requireNonNull(request.getType(), "成果类型不能为空");
        Date now = new Date();
        String type = request.getType();
        // file类型的成果在保存时已经被转换为实际文件类型（text、ppt、image等），
        // 取消收藏时不按type过滤，只根据sessionId、fileCode、messageId匹配
        if ("file".equalsIgnoreCase(type)) {
            type = null;
        }
        int affected = byaiShowcaseMapper.updateStatusByCondition(request.getSessionId(), type,
            StringUtils.isBlank(request.getFileCode()) ? null : request.getFileCode(), request.getMessageId(), 0, now);
        log.info("取消收藏成果结果 sessionId={} type={} fileCode={} messageId={} affected={}", request.getSessionId(),
            request.getType(), request.getFileCode(), request.getMessageId(), affected);
        return affected > 0;
    }

    /**
     * 获取成果详情
     *
     * @param id 成果ID
     * @return 详情DTO
     */
    public ShowcaseDetailDto getShowcaseDetail(Long id) {
        ByaiShowcase showcase = getShowcaseById(id);
        ShowcaseStrategy strategy = resolveStrategy(showcase.getType());
        return strategy.buildDetail(showcase);
    }

    /**
     * 下载成果内容
     *
     * @param id 成果ID
     * @return 下载结果
     */
    public ShowcaseDownloadResult download(Long id) {
        ByaiShowcase showcase = getShowcaseById(id);
        ShowcaseStrategy strategy = resolveStrategy(showcase.getType());
        return strategy.download(showcase);
    }

    public List<ByaiShowcaseVo> getByaiShowcaseList(ShowcaseQueryParam param) {
        return byaiShowcaseMapper.selectByCondition(param);
    }

    /**
     * 条件查询成果空间列表（带分页）
     *
     * @return 分页结果
     */
    public PageInfo<ByaiShowcaseVo> queryShowcaseList(ShowcaseQueryParam queryParam) {
        ShowcaseQueryParam param = queryParam == null ? new ShowcaseQueryParam() : queryParam;

        ShowcaseQueryParam normalized = param.normalize();
        boolean noFilter = normalized.getSessionId() == null && normalized.getAgentId() == null
            && normalized.getTaskId() == null && StringUtils.isBlank(normalized.getType())
            && StringUtils.isBlank(normalized.getKeyword()) && StringUtils.isBlank(normalized.getSessionMode());

        if (noFilter) {
            log.info("成果空间列表在无筛选条件下查询，pageNum:{} pageSize:{}", normalized.getPageNum(), normalized.getPageSize());
        }

        PageHelper.startPage(normalized.getPageNum(), normalized.getPageSize());
        if (!queryParam.getQueryAll()) {
            normalized.setCreateBy(CurrentUserHolder.getCurrentUserId());
        }
        normalized.setStatus(1);

        List<ByaiShowcaseVo> dataList = byaiShowcaseMapper.selectByCondition(normalized);

        com.github.pagehelper.PageInfo<ByaiShowcaseVo> pageData = new com.github.pagehelper.PageInfo<>(dataList);

        PageInfo<ByaiShowcaseVo> pageInfo = new PageInfo<>();
        pageInfo.setPageNum(pageData.getPageNum());
        pageInfo.setPageSize(pageData.getPageSize());
        pageInfo.setTotal(pageData.getTotal());
        pageInfo.setTotalPages(pageData.getPages());
        pageInfo.setList(pageData.getList());
        return pageInfo;
    }

    private ShowcaseStrategy resolveStrategy(String type) {
        return showcaseStrategyFactory.getStrategy(type);
    }

    private String resolveSessionMode(String type) {
        if (StringUtils.equalsIgnoreCase(type, "task")) {
            return "1";
        }
        return "0";
    }

    public Map<String, Object> saveToDoc(FileUploadDto dto) {
        String datasetId = dto.getDatasetId();
        if (StringUtils.isBlank(datasetId)) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.dataset.id.not.empty"));
        }
        String metadata = dto.getMetadata();
        if (StringUtils.isBlank(metadata)) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.metadata.not.empty"));
        }
        ByaiShowcase showcaseById = getShowcaseById(dto.getId());
        String fileId = showcaseById.getFileId();
        if (StringUtils.isBlank(fileId)) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.file.id.not.recorded"));
        }

        DownloadedFile downloadedFile = downloadShowcaseFile(fileId, showcaseById.getName());
        MultipartFile multipartFile = new MultipartFileUtil("file", downloadedFile.getFileName(),
            downloadedFile.getContentType(), downloadedFile.getFileBytes());
        MultipartFile[] files = new MultipartFile[] {
            multipartFile
        };
        ResponseUtil uploadResponse = resourceApplicationService.preUploadFile(datasetId, metadata, files);
        List<Map<String, Object>> uploadResults = extractUploadResults(uploadResponse);
        if (CollectionUtils.isEmpty(uploadResults)) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.upload.to.knowledge.empty.result"));
        }
        List<Long> rebuildFileIds = new ArrayList<>(uploadResults.size());
        for (Map<String, Object> uploadResult : uploadResults) {
            Long uploadFileId = MapParamUtil.getLongValue(uploadResult, "fileId");
            if (uploadFileId != null) {
                rebuildFileIds.add(uploadFileId);
            }
        }
        if (CollectionUtils.isEmpty(rebuildFileIds)) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.upload.no.valid.file.id"));
        }

        Map<String, Object> resultMap = new HashMap<>(4);
        resultMap.put("uploadFiles", uploadResults);
        resultMap.put("datasetId", datasetId);
        resultMap.put("datasetType", "4");
        return resultMap;
    }

    private DownloadedFile downloadShowcaseFile(String fileId, String fallbackName) {
        // 校验fileId格式，防止路径遍历攻击（fileId应为纯数字）
        if (StringUtils.isBlank(fileId) || !fileId.matches("^\\d+$")) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.file.id.invalid.format"));
        }

        OpenFileDownloadDTO openFileDownloadDTO = new OpenFileDownloadDTO();
        openFileDownloadDTO.setFileId(Long.parseLong(fileId));
        try (Response downloadResponse = fileService.downloadFiles(openFileDownloadDTO)) {
            if (downloadResponse == null || downloadResponse.body() == null) {
                throw new BdpRuntimeException(I18nUtil.get("showcase.download.no.available.stream"));
            }
            byte[] data;
            try (InputStream inputStream = downloadResponse.body().asInputStream()) {
                data = inputStream.readAllBytes();
            }
            if (data.length == 0) {
                throw new BdpRuntimeException(I18nUtil.get("showcase.download.file.content.empty"));
            }
            String contentType = MediaType.APPLICATION_OCTET_STREAM_VALUE;
            Collection<String> contentTypes = downloadResponse.headers().get(HttpHeaders.CONTENT_TYPE);
            if (CollectionUtils.isNotEmpty(contentTypes)) {
                contentType = contentTypes.iterator().next();
            }
            Collection<String> contentDispositions = downloadResponse.headers().get(HttpHeaders.CONTENT_DISPOSITION);
            String fileName = resolveFileName(contentDispositions, fallbackName, fileId);
            return new DownloadedFile(data, contentType, fileName);
        }
        catch (IOException ex) {
            throw new KnowledgeRuntimeExcepion(ex);
        }
    }

    private List<Map<String, Object>> extractUploadResults(ResponseUtil response) {
        if (!"0".equals(response.getResultCode()) || response.getData() == null) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.upload.to.knowledge.failed"));
        }
        return (List<Map<String, Object>>) response.getData();
    }

    private String resolveFileName(Collection<String> contentDispositions, String fallbackName, String fileId) {
        if (CollectionUtils.isNotEmpty(contentDispositions)) {
            for (String disposition : contentDispositions) {
                if (StringUtils.isBlank(disposition)) {
                    continue;
                }
                try {
                    ContentDisposition cd = ContentDisposition.parse(disposition);
                    String fileName = cd.getFilename();
                    if (StringUtils.isNotBlank(fileName)) {
                        return URLDecoder.decode(fileName, StandardCharsets.UTF_8);
                    }
                }
                catch (Exception ex) {
                    LOGGER.debug("解析文件名失败: {}", ex.getMessage());
                }
            }
        }
        if (StringUtils.isNotBlank(fallbackName)) {
            return fallbackName;
        }
        return fileId;
    }

    public List<ByaiMessageHotDto> getChatHistory(ShowcaseQueryRequest qo) {
        ByaiShowcase byaiShowcase = byaiShowcaseMapper.selectById(qo.getId());
        if (byaiShowcase == null) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.message.not.collected"));
        }
        String content = byaiShowcase.getContent();
        if (StringUtils.isBlank(content)) {
            return Collections.emptyList();
        }
        List<Long> list = Arrays.stream(byaiShowcase.getContent().split(",")).map(String::trim)
            .filter(StringUtils::isNotBlank).map(s -> {
                try {
                    return Long.valueOf(s);
                }
                catch (NumberFormatException e) {
                    log.warn("Invalid message ID format: {}", s);
                    return null;
                }
            }).filter(Objects::nonNull).collect(Collectors.toList());
        return messageService.getChatHistory(list);
    }

    public void save(ByaiShowcase showcase) {
        byaiShowcaseMapper.insert(showcase);

    }

    private static class DownloadedFile {

        private final byte[] fileBytes;

        private final String contentType;

        private final String fileName;

        DownloadedFile(byte[] fileBytes, String contentType, String fileName) {
            this.fileBytes = fileBytes;
            this.contentType = contentType;
            this.fileName = fileName;
        }

        byte[] getFileBytes() {
            return fileBytes;
        }

        String getContentType() {
            return contentType;
        }

        String getFileName() {
            return fileName;
        }
    }

}
