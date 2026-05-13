package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import lombok.Data;

/**
 * 模型启停请求（与接口文档 setModelStatus 入参一致）
 *
 * @author system
 */
@Data
public class ModelSetStatusRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 模型 ID */
    private String id;

    /** ENABLED 或 DISABLED（可选 TESTING） */
    private String status;
}
