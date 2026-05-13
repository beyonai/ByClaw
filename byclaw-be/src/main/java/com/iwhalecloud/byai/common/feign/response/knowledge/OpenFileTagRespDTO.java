package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Data;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-10 15:01:13
 * @description TODO
 */
@Getter
@Setter
public class OpenFileTagRespDTO {

    /**
     * 上传的文件列表
     */
    private List<FileInfo> files;

    /**
     * 文件信息内部信息
     */
    @Data
    public static class FileInfo {

        private Long fileId;

        private String fileName;

        private String tags;

        private String uploadDate;

        private Long datasetId;

        private String msg;
    }
}
