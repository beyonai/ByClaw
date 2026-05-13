package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import lombok.Data;

/**
 * 模型列表请求（分页+过滤）
 * 与接口文档 getModelListByPage 入参一致
 *
 * @author system
 */
@Data
public class ModelListRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 页码，从 1 开始 */
    private Integer pageNum = 1;

    /** 每页条数 */
    private Integer pageSize = 10;

    /** 状态过滤：ENABLED/DISABLED/TESTING */
    private String status;

    /** 能力过滤：VISION/FUNCTION_CALL/STREAM 等 */
    private Long ability;

    /** 系统过滤：super_assistant/chatbi/aiwrite */
    private String system;

    /** 按模型 ID 精确过滤 */
    private String modelId;

    /** 按模型名称模糊过滤（displayName） */
    private String modelName;

    /** 通用关键字（匹配 displayName/modelCode/providerName） */
    private String keyword;
}
