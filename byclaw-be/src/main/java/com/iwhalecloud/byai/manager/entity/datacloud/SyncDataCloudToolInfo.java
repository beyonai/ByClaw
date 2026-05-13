package com.iwhalecloud.byai.manager.entity.datacloud;

import lombok.Data;

import java.io.Serializable;

/**
 * @author cxf
 * @description: 同步给datacloud mcp服务的工具信息
 * @date 2025/9/28 13:52
 */
@Data
public class SyncDataCloudToolInfo implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * {
     *     "tool_id": "tool_02",
     *     "name": "contract_cross_analysis",
     *     "url": "https://jh.iwhalecloud.com/dapweb/dashboard/?dashboardType=0&pageIndex=1&pageSize=17&catalogType=4&keyName=&viewType=table&daId=2931",
     *     "description": "合同交叉分析",
     *     "input_schema": {
     *         "type": "object",
     *         "required": [
     *             "product_name"
     *         ],
     *         "properties": {
     *             "date_yyyymm": {
     *                 "type": "string",
     *                 "description": "月份",
     *                 "example": "202507"
     *             },
     *             "date_yyyymmdd": {
     *                 "type": "string",
     *                 "description": "日期",
     *                 "example": "20250701"
     *             },
     *             "product_name": {
     *                 "type": "string",
     *                 "description": "产品名称"
     *             }
     *         }
     *     },
     *     "code": "",
     *     "authConfig": {
     *         "auth_type": "whale_plus",
     *         "login_url": "https://ssodr.iwhalecloud.com:40083/login/v2/auth/login?appKey=8cDkpta5yc03oeBrzeRl",
     *         "call_back_url": "http://10.10.185.22:25880/get_storage_state",
     *         "param_position": "url",
     *         "auth_params": {
     *             "ssoCode": ""
     *         }
     *     }
     * }
     */
    private Long tool_id;
    /**
     * 关联的视图ID
     */
    private Long viewId;
    private String name;
    private String description;
    private String output_selector;
    private String url;
    private SyncToolInputSchema input_schema;
    private String code;
    private SyncAuthConfig auth_config;
}
