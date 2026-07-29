package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 技能资源扩展表 Mapper 接口
 *
 * @author qin.guoquan
 * @date 2026-06-18 19:38:38
 */
@Mapper
public interface SsResExtSkillMapper extends BaseMapper<SsResExtSkill> {

    /**
     * 根据编码查询技能信息
     *
     * @param skillCodes 资源标识
     * @return 技能资源及扩展信息列表
     */
    List<SsResExtSkillDto> findBySkillCodes(@Param("skillCodes") Collection<String> skillCodes);

    /**
     * PR-3 (#150) 批量查询技能扩展数据. 内部委托 MyBatis-Plus {@code selectBatchIds}
     * (单 SQL IN 子句),用于替代启动期循环 {@code findById} 触发的 N+1.
     *
     * @param resourceIds 资源ID列表(空集合时返回空 List,不会触发 SQL)
     * @return 技能扩展列表
     */
    default List<SsResExtSkill> findByIds(Collection<Long> resourceIds) {
        if (resourceIds == null || resourceIds.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return selectBatchIds(resourceIds);
    }

}
