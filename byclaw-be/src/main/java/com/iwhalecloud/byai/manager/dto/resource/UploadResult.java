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
    }

    private Long resourceId;

    private String resourceCode;

    private String resourceName;

    private List<UploadItem> uploadItems;
}
