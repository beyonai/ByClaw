package com.iwhalecloud.byai.common.storage.model;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

/**
 * 文件url解析后的文件对象存储信息
 *
 * @author hux
 * @date 2025-08-12
 */
@Getter
@Setter
@Builder
public class ParsedFileInfo {

    private String bucketName;

    private String filePath;
}
