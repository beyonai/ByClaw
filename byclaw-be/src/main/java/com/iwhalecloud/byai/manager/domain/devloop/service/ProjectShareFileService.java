package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectShareFile;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareFileMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 项目空间共享文件领域服务。
 */
@Slf4j
@Service
public class ProjectShareFileService {

    @Autowired
    private ProjectShareFileMapper shareFileMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 保存文件到项目空间。
     *
     * @param projectId 项目ID
     * @param fileId    文件ID
     * @param shareLink 分享链接
     * @return 已落库的共享文件记录
     */
    public ProjectShareFile save(Long projectId, Long fileId, String shareLink) {
        ProjectShareFile shareFile = new ProjectShareFile();
        shareFile.setShareId(sequenceService.nextVal());
        shareFile.setProjectId(projectId);
        shareFile.setFileId(fileId);
        shareFile.setShareLink(shareLink);
        shareFile.setCreateBy(CurrentUserHolder.getCurrentUserId());
        shareFile.setCreateTime(new Date());
        shareFileMapper.insert(shareFile);
        return shareFile;
    }

    /**
     * 按项目ID联查空间共享文件列表（含文件名、分享链接）。
     *
     * @param projectId 项目ID
     * @return 文件列表 DTO；无数据时返回空列表
     */
    public List<ProjectShareFileListDto> listSpaceFiles(Long projectId) {
        return shareFileMapper.listSpaceFiles(projectId);
    }

    /**
     * 判断文件是否仍关联在指定项目的共享空间内，避免跨项目操作文件。
     *
     * @param projectId 项目 ID
     * @param fileId 文件 ID
     * @return 是否存在关联记录
     */
    public boolean existsByProjectAndFile(Long projectId, Long fileId) {
        return shareFileMapper.selectCount(new LambdaQueryWrapper<ProjectShareFile>()
            .eq(ProjectShareFile::getProjectId, projectId)
            .eq(ProjectShareFile::getFileId, fileId)) > 0;
    }

    /**
     * 删除项目与共享文件的关联记录。
     *
     * @param projectId 项目 ID
     * @param fileId 文件 ID
     */
    public void removeByProjectAndFile(Long projectId, Long fileId) {
        shareFileMapper.delete(new LambdaQueryWrapper<ProjectShareFile>()
            .eq(ProjectShareFile::getProjectId, projectId)
            .eq(ProjectShareFile::getFileId, fileId));
    }
}
