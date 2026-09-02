package com.iwhalecloud.byai.common.feign.response.datacloud;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 调用知识库动作响应 data（POST /api/v1/rpc/kb/invokeAction）。
 */
@Getter
@Setter
public class InvokeActionResp {

    /** 动作执行结果记录列表 */
    private List<Map<String, Object>> records;

    /** 记录总数 */
    private Integer total;

    /** 执行元数据（object_code、kb_files、columns 等） */
    private Map<String, Object> meta;
}
