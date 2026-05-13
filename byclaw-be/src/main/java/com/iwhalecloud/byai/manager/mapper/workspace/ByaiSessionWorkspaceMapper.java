package com.iwhalecloud.byai.manager.mapper.workspace;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceListRequest;
import com.iwhalecloud.byai.manager.entity.workspace.ByaiSessionWorkspace;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 会话工作区表 Mapper
 *
 * @author system
 */
@Mapper
public interface ByaiSessionWorkspaceMapper extends BaseMapper<ByaiSessionWorkspace> {

    /**
     * 批量插入会话工作区记录
     *
     * @param list 待插入实体列表
     * @return 插入条数
     */
    int insertBatch(@Param("list") List<ByaiSessionWorkspace> list);

    List<ByaiSessionWorkspace> selectBySession(SessionWorkspaceListRequest request);

    /**
     * 批量更新 is_exist=1，按 id 列表
     *
     * @param ids 工作区主键 id 列表
     * @return 影响条数
     */
    int updateIsExistByIds(@Param("ids") List<Long> ids);
}
