package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFileDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectObjectFile;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectObjectFileMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 项目业务对象关联文件领域服务。
 */
@Service
public class ProjectObjectFileService {

    @Autowired
    private ProjectObjectFileMapper projectObjectFileMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 新增对象关联文件。
     *
     * @param projectObjectFile 待保存记录
     */
    public void save(ProjectObjectFile projectObjectFile) {
        if (projectObjectFile.getId() == null) {
            projectObjectFile.setId(sequenceService.nextVal());
        }

        if (projectObjectFile.getCreateTime() == null) {
            projectObjectFile.setCreateTime(new Date());
        }

        projectObjectFile.setCreateBy(CurrentUserHolder.getCurrentUserId());
        projectObjectFileMapper.insert(projectObjectFile);
    }

    /**
     * 按主键更新对象关联文件。
     *
     * @param projectObjectFile 待更新记录（须含主键）
     */
    public void update(ProjectObjectFile projectObjectFile) {
        projectObjectFile.setUpdateTime(new Date());
        projectObjectFileMapper.updateById(projectObjectFile);
    }

    /**
     * 按主键查询。
     *
     * @param id 主键
     * @return 记录，不存在返回 null
     */
    public ProjectObjectFile findById(Long id) {
        if (id == null) {
            return null;
        }
        return projectObjectFileMapper.selectById(id);
    }

    /**
     * 按会话 + 对象编码 + 文件名查询。
     *
     * @param sessionId 会话ID
     * @param objectCode 业务对象编码
     * @param filePath 文件名
     * @return 记录，不存在返回 null
     */
    public ProjectObjectFile findByBizKey(Long sessionId, String objectCode, String filePath) {
        if (StringUtils.isAnyBlank(sessionId + "", objectCode, filePath)) {
            return null;
        }
        return projectObjectFileMapper.selectOne(new LambdaQueryWrapper<ProjectObjectFile>()
            .eq(ProjectObjectFile::getSessionId, sessionId).eq(ProjectObjectFile::getObjectCode, objectCode)
            .eq(ProjectObjectFile::getFilePath, filePath).last("LIMIT 1"));
    }

    /**
     * 按项目、会话查询业务对象关联文件。
     *
     * @param listObjectFileDto 查询条件
     * @return 对象文件列表
     */
    public List<ProjectObjectFile> listProjectObjectFiles(ListObjectFileDto listObjectFileDto) {
        return projectObjectFileMapper.listProjectObjectFiles(listObjectFileDto);
    }
}
