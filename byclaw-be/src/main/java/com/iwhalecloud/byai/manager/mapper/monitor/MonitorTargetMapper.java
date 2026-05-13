package com.iwhalecloud.byai.manager.mapper.monitor;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.monitor.MonitorTarget;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

/**
 * 监控目标Mapper
 */
@Mapper
public interface MonitorTargetMapper extends BaseMapper<MonitorTarget> {

    /**
     * 根据数字员工ID查询监控目标
     *
     * @param agentId 数字员工ID
     * @return 监控目标
     */
    MonitorTarget selectByAgentId(@Param("agentId") Long agentId);

    /**
     * 删除不在指定数字员工集合内的监控记录
     *
     * @param targetType 目标类型
     * @param agentIds 当前有效的数字员工ID集合
     */
    void deleteByTargetTypeExcludeAgentIds(@Param("targetType") String targetType,
        @Param("agentIds") List<Long> agentIds);

    /**
     * 根据数字员工ID查询监控目标
     *
     * @param targetSubType 监控子类型
     * @param targetQuality 质量等级评级
     * @return 数字员工id列表
     */
    List<Long> selectLtTargetQuality(@Param("targetSubType") String targetSubType,
        @Param("targetQuality") String targetQuality);
}
