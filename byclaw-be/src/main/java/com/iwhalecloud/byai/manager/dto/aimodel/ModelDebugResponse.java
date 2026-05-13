package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import lombok.Data;

/**
 * 模型调试响应（与接口文档 debugModel 出参 data 一致）
 *
 * @author system
 */
@Data
public class ModelDebugResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 输出内容 */
    private String output;

    /** 耗时（毫秒） */
    private Long durationMs;

    /** 便于排查日志 */
    private String requestId;

    /** 调试是否成功（失败时仍返回 output/durationMs/requestId，便于前端展示） */
    private Boolean success;
}
