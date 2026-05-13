package com.iwhalecloud.byai.state.domain.assitsant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

@Data
@Schema(description = "数字员工关注请求参数")
public class FocusVo {
    @Schema(description = "数字员工ID", example = "123456", required = true)
    String agentId;
    String appId;

    List<Long> agentIdList;
}
