package com.iwhalecloud.byai.manager.dto.file;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 文件上传响应DTO
 */
@Getter
@Setter
public class UploadFilesRespDto {

    private Long fileId;

    private String fileName;

    private String fileUrl;

    private String tags;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date uploadDate;

    private Long datasetId;

    private String msg;
}