package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtTestSetQo;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtTestSetVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 数字员工测试集上传临时表Mapper
 */
@Mapper
public interface SsResExtTestSetMapper extends BaseMapper<SsResExtTestSet> {

    /**
     * 根据资源ID和批次ID查询测试集记录 最新成功
     *
     * @param resourceId 数字员工资源ID
     * @param batchId 测试集批次ID
     * @return SsResExtTestSet 测试集记录，如果不存在返回null
     */
    SsResExtTestSet selectByResourceIdAndBatchId(@Param("resourceId") Long resourceId, @Param("batchId") String batchId);

    /**
     * 根据资源ID查询最新的测试集记录
     *
     * @param resourceId 数字员工资源ID
     * @return SsResExtTestSet 最新的测试集记录，如果不存在返回null
     */
    SsResExtTestSet selectLatestByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 分页查询测试集记录
     *
     * @param page 分页对象
     * @param qo 查询对象
     * @return List<SsResExtTestSetVo>
     */
    List<SsResExtTestSetVo> selectTestSetByQo(Page<SsResExtTestSetVo> page, @Param("qo") SsResExtTestSetQo qo);
}