package com.iwhalecloud.byai.manager.entity.datacloud;

import lombok.Data;

import java.io.Serializable;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/28 13:56
 */
@Data
public class SyncToolProperties implements Serializable {
    private static final long serialVersionUID = 1L;

    private String type;
    private String description;
    private String example;
}
