package com.iwhalecloud.byai.manager.mapper.superassist;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassistResourcePrivilege;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.Map;

/**
 * 助理资源授权Mapper接口
 */
public interface SuasSuperassistResourcePrivilegeMapper extends BaseMapper<SuasSuperassistResourcePrivilege> {

    /**
     * 根据条件查询
     */
    List<SuasSuperassistResourcePrivilege> selectByCondition(@Param("assistantId") Long assistantId,
        @Param("resourceId") Long resourceId, @Param("resourceType") String resourceType);

    /**
     * 根据助理ID查询所有权限记录
     */
    List<SuasSuperassistResourcePrivilege> selectByAssistantId(@Param("assistantId") Long assistantId);

    /**
     * 根据助理ID查询权限信息（关联查询资源名称）
     */
    List<Map<String, Object>> selectByAssistantIdWithResourceName(@Param("assistantId") Long assistantId);

    /**
     * 根据助理ID、权限类型、资源类型查询权限信息（关联查询资源名称）
     */
    List<Map<String, Object>> selectByAssistantIdWithResourceNameAndConditions(@Param("assistantId") Long assistantId,
        @Param("privilegeType") String privilegeType, @Param("resourceType") String resourceType);

    /**
     * 插入记录
     */
    int insert(SuasSuperassistResourcePrivilege record);

    /**
     * 批量插入记录
     */
    int batchInsert(List<SuasSuperassistResourcePrivilege> records);

}
