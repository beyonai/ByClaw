package com.iwhalecloud.byai.gateway.sandbox.persistence;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@TableName("sandbox_service_profile")
@Data
public class SandboxServiceProfileEntity {

    @TableId("id")
    private Long id;

    private String serviceType;

    private String profileKey;

    private String resourceRequests;

    private String resourceLimits;

    private String templatePatchJson;

    private Integer resizeEnabled;

    private String resizeStrategy;

    private Integer enabled;

    private Integer sortOrder;
}
