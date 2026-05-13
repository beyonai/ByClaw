package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import lombok.Data;

/**
 * 按模型 ID 操作的请求（删除、详情等）
 *
 * @author system
 */
@Data
public class ModelIdRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 模型 ID */
    private String id;
}
