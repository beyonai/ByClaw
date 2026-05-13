package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;
import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-13 17:54:31
 * @description TODO
 */
@Getter
@Setter
public class FileUploadDto {

    private boolean enabled = true;

    private long maxFileSize = 0L;

    private long maxFileCount = 0L;

    /**
     * 允许上传word文档的最大页数
     */
    private int maxWordPage = 10;

    /**
     * 允许上传pdf文档的最大页数
     */
    private int maxPdfPage = 10;

    private List<String> allowedFileTypes = new ArrayList<>();

}
