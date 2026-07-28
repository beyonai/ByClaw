package com.iwhalecloud.byai.manager.domain.system.service;

import com.iwhalecloud.byai.manager.mapper.system.AttachFileMapper;
import com.iwhalecloud.byai.manager.entity.system.AttachFile;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-08-19 19:45:46
 * @description 附件文件服务
 */
@Service
public class AttachFileService {

    @Autowired
    private AttachFileMapper attachFileMapper;

    /**
     * 保存附件文件
     * 
     * @param attachFile 附件文件信息
     */
    public void save(AttachFile attachFile) {
        attachFileMapper.insert(attachFile);
    }

    /**
     * 更新文件
     * 
     * @param attachFile 文件信息
     */
    public void update(AttachFile attachFile) {
        attachFileMapper.updateById(attachFile);
    }

    /**
     * 查询来源文件标识
     * 
     * @param attachFileId 文件标识
     */
    public AttachFile selectById(Long attachFileId) {
        return attachFileMapper.selectById(attachFileId);
    }

}
