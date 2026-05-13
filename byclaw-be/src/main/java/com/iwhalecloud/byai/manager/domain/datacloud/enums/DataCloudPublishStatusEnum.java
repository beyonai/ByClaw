package com.iwhalecloud.byai.manager.domain.datacloud.enums;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/9 17:23
 */
public enum DataCloudPublishStatusEnum {
    /**
     * 未发布
     */
    UNPUBLISHED(2),
    /**
     * 已发布
     */
    PUBLISHED(1),
    /**
     * 草稿
     */
    DRAFT(0);

    private Integer value;

    DataCloudPublishStatusEnum(Integer value) {
        this.value = value;
    }

    public Integer getValue() {
        return value;
    }

    public void setValue(Integer value) {
        this.value = value;
    }
}
