package com.iwhalecloud.byai.common.feign.response.knowledge;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;
import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-21 16:14:44
 * @description TODO
 */

@Getter
@Setter
public class FileUploadConfig {

    @JSONField(name = "enabled")
    private boolean enabled = true;

    private long maxFileSize = 0L;

    private long maxFileCount = 0L;

    private List<String> allowedFileTypes = new ArrayList<>();
}
