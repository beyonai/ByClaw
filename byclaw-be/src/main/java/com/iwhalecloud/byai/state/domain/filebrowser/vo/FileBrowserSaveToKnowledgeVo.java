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

    /** 已受理构建请求的文件数，不表示构建已完成。 */
    private int buildSubmittedCount;

    private List<UploadItem> failedItems = new ArrayList<>();

    private List<UploadItem> buildFailedItems = new ArrayList<>();

    private List<String> postProcessErrors = new ArrayList<>();

    private List<UploadItem> uploadItems = new ArrayList<>();
}
