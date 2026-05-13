package com.iwhalecloud.byai.manager.domain.customer.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.dto.file.UploadFilesRespDto;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-02 14:16:07
 * @description TODO
 */
@Service
public class FilesService {

    @Autowired
    private FilesMapper filesMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 查找文件信息
     *
     * @param fileId 文件信息
     */
    public Files findById(Long fileId) {
        return filesMapper.selectById(fileId);
    }

    /**
     * 批量查找文件信息
     *
     * @param fileIds 文件标识
     */
    public List<Files> findByIds(Collection<Long> fileIds) {
        LambdaQueryWrapper<Files> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(Files::getFileId, fileIds);
        return filesMapper.selectList(queryWrapper);
    }

    /**
     * 保存文件
     *
     * @param files 文件信息
     */
    public Files save(Files files) {
        filesMapper.insert(files);
        return files;
    }

    /**
     * 更新文件
     *
     * @param files 文件信息
     */
    public void updateById(Files files) {
        filesMapper.updateById(files);
    }

    /**
     * 删除文件
     *
     * @param fileId 文件标识
     */
    public void remove(Long fileId) {
        filesMapper.deleteById(fileId);
    }

    /**
     * 查询匹配的文件列表
     *
     * @param chatId 会话标识
     * @param tags 标记
     * @param matchMode 匹配模式
     * @return List
     */
    public List<UploadFilesRespDto> selectByMatchTags(Long chatId, String tags, String matchMode) {
        return filesMapper.selectByMatchTags(chatId, tags, matchMode);
    }

    /**
     * 创建文件
     *
     * @param fileName 文件名
     * @param contentType 文件类型
     * @param resourceId 资源标识
     * @param fileCollectId 资源目录
     * @param chatId 会话标识
     * @param fileUrl 请求地址
     * @return Files
     */
    public Files createUploadFile(String fileName, String contentType, Long resourceId, Long fileCollectId, Long chatId,
        String fileUrl) {
        Files byaiFiles = new Files();
        byaiFiles.setFileId(sequenceService.nextVal());
        byaiFiles.setFileName(fileName);
        byaiFiles.setConvertFileName(fileName);
        byaiFiles.setContentType(contentType);
        byaiFiles.setDatasetId(resourceId);
        byaiFiles.setFileCollectId(fileCollectId);
        byaiFiles.setFileType(StringUtil.getFileSuffix(fileName));
        byaiFiles.setCreateBy(CurrentUserHolder.getCurrentUserId());
        byaiFiles.setUploadDate(new Date());
        byaiFiles.setCompleteTime(new Date());
        byaiFiles.setChatId(chatId);
        byaiFiles.setFileUrl(fileUrl);
        return this.save(byaiFiles);
    }
}
