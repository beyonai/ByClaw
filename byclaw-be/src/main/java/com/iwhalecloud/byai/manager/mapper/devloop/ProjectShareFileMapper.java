package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
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
}
