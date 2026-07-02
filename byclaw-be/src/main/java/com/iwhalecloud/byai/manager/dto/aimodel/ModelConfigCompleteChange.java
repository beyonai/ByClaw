package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 一键完善模型配置的字段变更记录。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ModelConfigCompleteChange implements Serializable {

    private static final long serialVersionUID = 1L;

    private String field;

    private Object before;

    private Object after;
}
