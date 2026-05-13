package com.iwhalecloud.byai.state.domain.searchask.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDirRel;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirRelMapper;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-09 10:05:57
 * @description TODO
 */
@Service
public class SpaceDirRelService {

    @Autowired
    private SpaceDirRelMapper spaceDirRelMapper;

    /**
     * 保存关联关系
     * 
     * @param spaceDirRel 保存
     */
    public void save(SpaceDirRel spaceDirRel) {
        spaceDirRelMapper.insert(spaceDirRel);
    }

    /**
     * 移除当前记录
     * 
     * @param dirRelId 目录关联
     */
    public void removeById(Long dirRelId) {
        spaceDirRelMapper.deleteById(dirRelId);
    }

    /**
     * 移除当前记录
     * 
     * @param dirId 目录
     * @param dataType 数据类型
     * @param dataId 数据标识
     */
    public void remove(Long dirId, String dataType, Long dataId) {
        LambdaQueryWrapper<SpaceDirRel> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SpaceDirRel::getDirId, dirId);
        queryWrapper.eq(SpaceDirRel::getDataType, dataType);
        queryWrapper.eq(SpaceDirRel::getDataId, dataId);
        spaceDirRelMapper.delete(queryWrapper);
    }

    /**
     * 查询目录下面关联关系
     *
     * @param dirId 目录标识
     * @param dataType 目录类型
     */
    public List<SpaceDirRel> findByDirId(Long dirId, String dataType) {
        LambdaQueryWrapper<SpaceDirRel> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SpaceDirRel::getDirId, dirId);
        if (StringUtil.isNotEmpty(dataType)) {
            queryWrapper.eq(SpaceDirRel::getDataType, dataType);
        }
        return spaceDirRelMapper.selectList(queryWrapper);
    }

    /**
     * 统计关联是否已经存在
     * 
     * @param dirId 挂载目录
     * @param dataType 数据类型
     * @param dataId 数据标识
     * @return Long
     */
    public long countSpaceDirRel(Long dirId, String dataType, Long dataId) {
        LambdaQueryWrapper<SpaceDirRel> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SpaceDirRel::getDirId, dirId);
        queryWrapper.eq(SpaceDirRel::getDataType, dataType);
        queryWrapper.eq(SpaceDirRel::getDataId, dataId);
        return spaceDirRelMapper.selectCount(queryWrapper);
    }

}
