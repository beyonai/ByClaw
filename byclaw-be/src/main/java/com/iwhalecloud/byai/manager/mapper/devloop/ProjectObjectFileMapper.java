package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFileDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectObjectFile;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

/**
 * 项目业务对象关联文件 Mapper。
 */
@Mapper
public interface ProjectObjectFileMapper extends BaseMapper<ProjectObjectFile> {

    /**
     * 按项目、会话查询业务对象关联文件。
     *
     * @param listObjectFileDto 查询条件
     * @return 对象文件列表
     */
    List<ProjectObjectFile> listProjectObjectFiles(ListObjectFileDto listObjectFileDto);
}
