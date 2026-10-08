package com.iwhalecloud.byai.manager.domain.resource.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

@Data
public class ResourceFavoriteQo {
    @NotNull
    @Positive
    private Long resourceId;

    /** 设置目标状态，重复提交同一状态不会重复计数。 */
    @NotNull
    private Boolean favorited;
}
