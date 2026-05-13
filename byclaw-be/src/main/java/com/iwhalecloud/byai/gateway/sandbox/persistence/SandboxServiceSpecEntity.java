package com.iwhalecloud.byai.gateway.sandbox.persistence;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 表 {@code sandbox_service_spec}。
 */
@TableName("sandbox_service_spec")
@Data
public class SandboxServiceSpecEntity {

    @TableId("service_key")
    private String serviceKey;
    private String specJson;
    private String templateJson;
}
