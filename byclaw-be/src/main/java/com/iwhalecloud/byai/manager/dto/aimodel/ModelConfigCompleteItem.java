package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

/**
 * 单个模型一键完善结果。
 */
@Data
public class ModelConfigCompleteItem implements Serializable {

    private static final long serialVersionUID = 1L;

    private String id;

    private String displayName;

    private String modelCode;

    private String modelType;

    /**
     * UPDATED / SKIPPED / FAILED
     */
    private String status;

    /**
     * HIGH / MEDIUM / LOW
     */
    private String confidence;

    /**
     * DEFAULT_LLM / BUILTIN_REGISTRY / NONE
     */
    private String source;

    private List<ModelConfigCompleteChange> changes = new ArrayList<>();

    private List<String> warnings = new ArrayList<>();

    private String errorMessage;
}
