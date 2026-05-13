package com.iwhalecloud.byai.manager.dto.operations;

import lombok.Data;

import java.util.Map;

/**
 * 消息引用对象使用指标、技能指标查询请求DTO
 * @author zzh
 */
@Data
public class MessageRelObjMetricsRequest {

    /**
     * 额外查询参数，用于动态SQL参数替换
     * 例如：{"startTime": "1920-01-01 00:00:00","endTime": "1920-01-01 00:00:00", "resourceId": "456"}
     */
    private Map<String, Object> params;

    /**
     * 执行ES的json编码
     */
    private String queryCode;

}