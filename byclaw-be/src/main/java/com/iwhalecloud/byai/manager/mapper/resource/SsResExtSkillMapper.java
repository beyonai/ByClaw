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

}
