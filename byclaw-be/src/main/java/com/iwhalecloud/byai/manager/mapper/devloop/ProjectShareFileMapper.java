package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextSharedFileDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectShareFile;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectShareFileMapper extends BaseMapper<ProjectShareFile> {

    /**
     * 按项目ID联查空间共享文件列表。
     *
     * @param projectId 项目ID
     * @return 文件列表 DTO
     */
    List<ProjectShareFileListDto> listSpaceFiles(@Param("projectId") Long projectId);

    /** 查询数字员工项目上下文中的共享文件摘要，限制返回条数以控制模型上下文。 */
    List<ProjectContextSharedFileDto> listContextFiles(@Param("projectId") Long projectId,
                                                       @Param("limit") int limit);

    /** 统计项目共享文件总数，用于标记结果是否被截断。 */
    long countContextFiles(@Param("projectId") Long projectId);
}
