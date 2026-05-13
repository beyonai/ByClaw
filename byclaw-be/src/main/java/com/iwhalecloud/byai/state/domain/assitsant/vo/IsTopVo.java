package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

@Data
@Schema(description = "是否置顶请求参数")
public class IsTopVo {

    @Schema(description = "数字员工IDs")
    List<Long> agentIds;

    @Schema(description = "类型")
    List<String> agentTypeList;

    @Schema(description = "是否置顶")
    Integer isTop = 1;
}
