package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-04-03 15:57:01
 * @description TODO
 */
@Getter
@Setter
public class UploadResult {

    public UploadResult() {
        this.uploadItems = new ArrayList<>();
        this.failedItems = new ArrayList<>();
        this.summary = new Summary();
        this.postProcessErrors = new ArrayList<>();
    }

    private Long resourceId;

    private String resourceCode;

    private String resourceName;

    private List<UploadItem> uploadItems;

    /** QA 返回的逐文件失败项，不混入 uploadItems，避免下游继续触发构建。 */
    private List<UploadItem> failedItems;

    private Summary summary;

    private List<String> postProcessErrors;

    @Getter
    @Setter
    public static class Summary {

        private Integer total = 0;

        private Integer succeeded = 0;

        private Integer failed = 0;
    }
}
