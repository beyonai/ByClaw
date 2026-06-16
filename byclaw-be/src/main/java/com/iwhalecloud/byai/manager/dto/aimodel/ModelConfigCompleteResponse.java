package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

/**
 * 模型配置一键完善批量结果。
 */
@Data
public class ModelConfigCompleteResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private Integer total = 0;

    private Integer updated = 0;

    private Integer skipped = 0;

    private Integer failed = 0;

    private List<ModelConfigCompleteItem> items = new ArrayList<>();
}
