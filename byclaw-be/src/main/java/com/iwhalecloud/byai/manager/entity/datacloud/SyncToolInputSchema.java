package com.iwhalecloud.byai.manager.entity.datacloud;

import lombok.Data;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/28 13:56
 */
@Data
public class SyncToolInputSchema implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * {
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
     */

    private String type;
    private List<String> required;
    private Map<String, SyncToolProperties> properties;
}
