package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;
import java.util.List;

@Data
public class WorkgroupTemplateRequest {
    @NotBlank @Size(max = 100) private String templateName;
    // 资产目录中的“其他领域”使用 ID 0，允许与普通目录一样保存模板。
    @NotNull(message = "{workgroup.template.catalog.required}")
    @Min(value = 0, message = "{workgroup.template.catalog.id.invalid}")
    private Long catalogId;
    @NotBlank @Size(max = 500) private String summary;
    @NotBlank @Size(max = 100) private String defaultGroupName;
    @NotBlank @Size(max = 500) private String defaultGoal;
    @NotEmpty private List<@NotNull @Positive Long> resourceIds;
    @Size(max = 64) private String icon;
    private Integer sortOrder;
    private Long expectedVersion;
}
