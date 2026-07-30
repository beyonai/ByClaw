package com.iwhalecloud.byai.state.domain.filebrowser.vo;

import java.util.ArrayList;
import java.util.List;

import com.iwhalecloud.byai.manager.dto.resource.UploadItem;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件模块保存到知识库结果。
 */
@Getter
@Setter
public class FileBrowserSaveToKnowledgeVo {

    private Long resourceId;

    private Long targetResourceId;

    private String sourcePath;

    private String targetDirectoryPath;

    private int createdFolderCount;

    private int uploadedFileCount;

    private List<UploadItem> uploadItems = new ArrayList<>();
}
