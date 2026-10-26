package com.iwhalecloud.byai.state.application.service.dataset;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeMetadataSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.ProjectCloudSearchRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;

/**
 * 将工作组云盘筛选编译为 ByKC 元数据查询，在分页前排除隐藏任务成果。
 * @author Codex
 * @date 2026-10-26
 */
@Service
public class ProjectCloudSearchApplicationService {

    @Autowired
    private DatasetApplicationService datasets;

    @Autowired
    private SsResourceService resources;

    @Autowired
    private AuthApplicationService authorization;

    /**
     * 搜索可访问的项目云盘，保持 ByKC 的分页、目录类型和排序。
     * @param request 云盘范围和筛选条件
     * @return 后端筛选后的分页及创建人展示信息
     */
    public KnowledgeMetadataSearchResult search(ProjectCloudSearchRequest request) {
        SsResource resource = resources.findById(request.getResourceId());
        if (resource == null || !"KG_CLOUD".equals(resource.getResourceBizType())
            || !authorization.hasResourceAccessPermission(resource)) {
            throw new BaseException("dataset.cloud.access.denied");
        }

        List<Map<String, Object>> conditions = new ArrayList<>();
        // 与工作组云盘视图一致，保留的任务成果名称及其任意层级内容均在 ByKC 分页前排除。
        conditions.add(Map.of("not", leaf("wildcard", "filePath", "*/group-task-results/*")));
        conditions.add(Map.of("not", leaf("wildcard", "filePath", "*/group-task-results")));
        String keyword = StringUtils.trimToEmpty(request.getKeyword());
        if (!keyword.isEmpty()) {
            conditions.add(leaf("wildcard", "fileName", "*" + keyword + "*"));
        }
        String fileType = StringUtils.trimToEmpty(request.getFileType()).toLowerCase(Locale.ROOT);
        if (!fileType.isEmpty()) {
            if (!"(none)".equals(fileType) && !fileType.matches("[a-z0-9][a-z0-9_-]{0,31}")) {
                throw new BaseException("dataset.cloud.search.type.invalid");
            }
            conditions.add(leaf("eq", "fileType", "(none)".equals(fileType) ? "" : fileType));
        }
        if (request.getCreatorId() != null) {
            ShareBfmUser creator = ShareCacheUtil.getShareBfmUser(request.getCreatorId());
            if (creator == null || StringUtils.isBlank(creator.getUserCode())) {
                throw new BaseException("dataset.cloud.search.creator.invalid");
            }
            conditions.add(leaf("eq", "userCode", creator.getUserCode()));
        }
        addDates(conditions, request);

        KnowledgeMetadataSearchRequest query = new KnowledgeMetadataSearchRequest();
        query.setResourceIdList(List.of(request.getResourceId()));
        query.setWhere(Map.of("and", conditions));
        query.setMetadataFieldList(List.of("fileName", "fileType", "fileSize", "createdAt", "updatedAt", "userCode"));
        query.setPageNum(request.getPageNum());
        query.setPageSize(request.getPageSize());
        KnowledgeMetadataSearchResult result = datasets.searchKnowledgeMetadata(query);
        Map<String, ShareBfmUser> creators = new HashMap<>();
        // 兼容历史条目缺少元数据；姓名补全不能阻断合法的文件检索结果。
        if (result.getData() == null) {
            return result;
        }
        result.getData().forEach(item -> {
            if (item == null || item.getMetadata() == null) {
                return;
            }
            Object owner = item.getMetadata().get("userCode");
            if (owner instanceof Map<?, ?> metadata && metadata.get("value") instanceof String userCode) {
                ShareBfmUser creator = creators.computeIfAbsent(userCode, ShareCacheUtil::getShareBfmUser);
                if (creator != null) {
                    item.setCreateStaffName(creator.getUserName());
                }
            }
        });
        return result;
    }

    /** 将完整日期范围转换为左闭右开条件，拒绝无时区时间和倒置范围。 */
    private void addDates(List<Map<String, Object>> conditions, ProjectCloudSearchRequest request) {
        boolean hasFrom = StringUtils.isNotBlank(request.getCreatedFrom());
        boolean hasBefore = StringUtils.isNotBlank(request.getCreatedBefore());
        if (!hasFrom && !hasBefore) {
            return;
        }
        try {
            if (!hasFrom || !hasBefore) {
                throw new BaseException("dataset.cloud.search.date.invalid");
            }
            OffsetDateTime from = OffsetDateTime.parse(request.getCreatedFrom());
            OffsetDateTime before = OffsetDateTime.parse(request.getCreatedBefore());
            if (!from.isBefore(before)) {
                throw new BaseException("dataset.cloud.search.date.invalid");
            }
            conditions.add(leaf("gte", "createdAt", from.toString()));
            conditions.add(leaf("lt", "createdAt", before.toString()));
        } catch (DateTimeParseException exception) {
            throw new BaseException("dataset.cloud.search.date.invalid");
        }
    }

    /** 只构造文档支持的叶子节点，不拼接 SQL。 */
    private Map<String, Object> leaf(String operator, String fieldName, Object value) {
        return Map.of(operator, Map.of("fieldName", fieldName, "value", value));
    }
}
