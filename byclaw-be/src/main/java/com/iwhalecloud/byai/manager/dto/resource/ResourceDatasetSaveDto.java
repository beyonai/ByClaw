package com.iwhalecloud.byai.manager.dto.resource;

import java.io.Serial;
import java.io.Serializable;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 数据集保存请求DTO
 */
@Getter
@Setter
public class ResourceDatasetSaveDto implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源名称
     */
    @NotBlank(message = "{resourcedto.resourcename.notblank}")
    @Size(max = 128, message = "{resourcedto.resourcename.size}")
    @Pattern(regexp = "^[a-zA-Z\\u4e00-\\u9fa5][a-zA-Z0-9\\u4e00-\\u9fa5_]*$",
            message = "{resourcedto.resourcename.regexp}")
    private String resourceName;

    /**
     * 资源描述
     */
    @NotBlank(message = "{resourcedto.resourcedesc.notblank}")
    @Size(max = 1024, message = "{resourcedto.resourcedesc.size}")
    private String resourceDesc;

    /**
     * 资源类型
     */
    private String resourceBizType;

    /**
     * 外系统编码
     */
    private String systemCode;

    /**
     * 资源实现方式
     */
    private String implType;

    /**
     * 资源对应Agent的在Worker中的注册类型
     */
    private String workerAgentType;

}
