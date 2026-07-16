package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanSourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

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

    /** 查询所有启用且未删除的扫描源，供定时任务使用 */
    public List<ScanSource> listEnabledSources() {
        LambdaQueryWrapper<ScanSource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanSource::getEnabled, "1")
               .eq(ScanSource::getDeleteFlag, "0");
        return scanSourceMapper.selectList(wrapper);
    }

    /** 更新扫描源最近扫描时间 */
    public void updateLastScanTime(Long sourceId) {
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setLastScanTime(new Date());
        scanSourceMapper.updateById(source);
    }
}
