package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtEvaluateQO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 数字员工评估旧数据表Mapper接口
 */
@Mapper
public interface SsResExtEvaluateMapper extends BaseMapper<SsResExtEvaluate> {

    /**
     * 根据资源ID查询评估时间最新的记录
     *
     * @param resourceId 数字员工资源ID
     * @return SsResExtEvaluate 最新的评估记录
     */
    SsResExtEvaluate selectLatestByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 分页查询数字员工评估结果
     *
     * @param page 分页参数
     * @param qo 查询条件
     * @return 分页评估结果
     */
    Page<SsResExtEvaluate> selectPageByQO(IPage<SsResExtEvaluate> page, @Param("qo") SsResExtEvaluateQO qo);
}
