package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-03 15:57:26
 * @description TODO
 */
@Getter
@Setter
public class UploadItem {

    private Long fileId;

    private String fileName;

    private String filePath;

    private String fileUrl;
}
