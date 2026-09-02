package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanSourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 扫描源领域服务
 * 提供扫描源的增删改查及状态管理
 */
@Slf4j
@Service
public class ScanSourceService {

    /** 运营需求类型直接复用 source_type，不再增加额外记录类型字段。 */
    public static final String OPERATION_SOURCE_TYPE_COLLECT = "collect";

    /** 运营需求中的知识整理类型，创建阶段只保存目标，启动时再拆解为具体任务。 */
    public static final String OPERATION_SOURCE_TYPE_KNOWLEDGE = "knowledge";

    public static final String OPERATION_SOURCE_TYPE_PUBLISH = "publish";

    public static final String OPERATION_SOURCE_TYPE_ANALYZE = "analyze";

    public static final Set<String> OPERATION_SOURCE_TYPES = Set.of(OPERATION_SOURCE_TYPE_COLLECT,
        OPERATION_SOURCE_TYPE_KNOWLEDGE, OPERATION_SOURCE_TYPE_PUBLISH, OPERATION_SOURCE_TYPE_ANALYZE);

    /**
     * 定时聊天型自动化：config 存的是 AssistantChatDto 入参本身（agentId/chatContent 等），
     * 到点直接发起一次 chat，不扫外部渠道、不进拆分评分与自动派生链路。
     * 与 github_issue/dingtalk 的区别在于「没有外部数据源」，所以 config 语义完全不同，
     * 各扫描服务按 source_type 各读自己的键，不共享 schema。
     */
    public static final String SOURCE_TYPE_CHAT = "chat";

    @Autowired
    private ScanSourceMapper scanSourceMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建扫描源，自动生成ID和初始状态 */
    public ScanSource create(ScanSource source) {
        source.setSourceId(sequenceService.nextVal());
        source.setCreateTime(new Date());
        source.setDeleteFlag("0");
        if (source.getEnabled() == null) {
            source.setEnabled("1");
        }
        scanSourceMapper.insert(source);
        return source;
    }

    /** 更新扫描源字段（仅更新非null属性） */
    public void update(ScanSource source) {
        source.setUpdateTime(new Date());
        scanSourceMapper.updateById(source);
    }

    /** 根据ID查询扫描源 */
    public ScanSource findById(Long sourceId) {
        return scanSourceMapper.selectById(sourceId);
    }

    /** 软删除扫描源 */
    public void delete(Long sourceId) {
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setDeleteFlag("1");
        source.setUpdateTime(new Date());
        scanSourceMapper.updateById(source);
    }

    /** 查询项目下未删除的扫描源列表 */
    public List<ScanSource> listByProjectId(Long projectId) {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getProjectId, projectId)
               .eq(ScanSource::getDeleteFlag, "0")
               .orderByDesc(ScanSource::getCreateTime);
        return scanSourceMapper.selectList(wrapper);
    }

    /** 分页查询项目渠道，搜索只匹配渠道名称并排除手工需求使用的内部来源。 */
    public Page<ScanSource> listByProjectIdPage(Long projectId, String keyword, String excludedSourceType, int pageNum,
        int pageSize) {
        return listByProjectIdPage(projectId, keyword,
            excludedSourceType == null ? Set.of() : Set.of(excludedSourceType), pageNum, pageSize);
    }

    /** 分页查询渠道，并排除手工来源及运营需求来源，避免共享 source 表后跨模块串数据。 */
    public Page<ScanSource> listByProjectIdPage(Long projectId, String keyword, Collection<String> excludedSourceTypes,
        int pageNum, int pageSize) {
        return listByProjectIdPage(projectId, keyword, excludedSourceTypes, null, pageNum, pageSize);
    }

    /**
     * 分页查询渠道，可再按创建人收窄。 createBy 非空时只返回该用户建的行：应用级自动化页跨项目查询，不按创建人收窄就会互相看到别人的自动化。
     */
    public Page<ScanSource> listByProjectIdPage(Long projectId, String keyword, Collection<String> excludedSourceTypes,
        String createBy, int pageNum, int pageSize) {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        // projectId 为空表示应用级自动化页跨项目查询；这里必须用条件重载，
        // 否则 eq(null) 会生成 project_id = NULL，一条都匹配不到。
        wrapper.eq(projectId != null, ScanSource::getProjectId, projectId).eq(ScanSource::getDeleteFlag, "0");
        // create_by 是 VARCHAR，调用方统一传字符串化的用户 ID，与 requireSourceCreator 的比较口径一致。
        wrapper.eq(org.apache.commons.lang3.StringUtils.isNotBlank(createBy), ScanSource::getCreateBy, createBy);
        if (excludedSourceTypes != null && !excludedSourceTypes.isEmpty()) {
            // 保留历史空类型渠道，仅排除明确的内部来源和运营需求来源。
            wrapper.and(query -> query.isNull(ScanSource::getSourceType).or()
                .notIn(ScanSource::getSourceType, excludedSourceTypes));
        }
        String normalizedKeyword = org.apache.commons.lang3.StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 的 LIKE 区分大小写，渠道名称统一小写后支持大小写混输搜索。
            wrapper.apply("LOWER(source_name) LIKE {0}", "%" + normalizedKeyword.toLowerCase(Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(ScanSource::getCreateTime);
        return scanSourceMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }

    /** 分页查询项目下的运营需求，需求记录和研发扫描渠道共用 source_id。 */
    public Page<ScanSource> pageOperationRequirements(Long projectId, String keyword, int pageNum, int pageSize) {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getProjectId, projectId)
            .eq(ScanSource::getDeleteFlag, "0")
            .in(ScanSource::getSourceType, OPERATION_SOURCE_TYPES);
        String normalizedKeyword = org.apache.commons.lang3.StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 的 LIKE 区分大小写，运营需求搜索统一使用小写比较。
            wrapper.apply("LOWER(source_name) LIKE {0}", "%" + normalizedKeyword.toLowerCase(Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(ScanSource::getCreateTime).orderByDesc(ScanSource::getSourceId);
        return scanSourceMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }

    /** 查询某用户创建的指定类型扫描源，供运行记录按「我的自动化」反查。 */
    public List<ScanSource> listByCreateByAndType(String createBy, String sourceType) {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getCreateBy, createBy)
               .eq(ScanSource::getSourceType, sourceType)
               .eq(ScanSource::getDeleteFlag, "0")
               .orderByDesc(ScanSource::getCreateTime);
        return scanSourceMapper.selectList(wrapper);
    }

    /** 查询所有启用且未删除的扫描源，供定时任务使用 */
    public List<ScanSource> listEnabledSources() {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getEnabled, "1")
               .eq(ScanSource::getDeleteFlag, "0");
        return scanSourceMapper.selectList(wrapper);
    }

    /** 统计关联到指定仓库的未删除扫描源数量，用于删除仓库前的占用校验 */
    public Long countByRepoId(Long repoId) {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getRepoId, repoId)
               .eq(ScanSource::getDeleteFlag, "0");
        return scanSourceMapper.selectCount(wrapper);
    }

    /** 更新扫描源最近扫描时间 */
    public void updateLastScanTime(Long sourceId) {
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setLastScanTime(new Date());
        scanSourceMapper.updateById(source);
    }
}
