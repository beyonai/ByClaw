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
import java.util.List;
import java.util.Locale;

/**
 * 扫描源领域服务
 * 提供扫描源的增删改查及状态管理
 */
@Slf4j
@Service
public class ScanSourceService {

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
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getProjectId, projectId).eq(ScanSource::getDeleteFlag, "0");
        if (excludedSourceType != null) {
            // 保留历史空类型渠道，仅排除手工需求创建的明确内部来源。
            wrapper.and(query -> query.isNull(ScanSource::getSourceType).or()
                .ne(ScanSource::getSourceType, excludedSourceType));
        }
        String normalizedKeyword = org.apache.commons.lang3.StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 的 LIKE 区分大小写，渠道名称统一小写后支持大小写混输搜索。
            wrapper.apply("LOWER(source_name) LIKE {0}", "%" + normalizedKeyword.toLowerCase(Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(ScanSource::getCreateTime);
        return scanSourceMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
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
