package com.iwhalecloud.byai.manager.qo.index;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 最近联系人查询请求对象
 *
 * @author system
 * @version 1.0
 * @date 2025/1/27
 */
@Data
@Schema(description = "最近联系人查询请求参数")
public class RecentContactQueryQo {

    /**
     * 页码
     */
    @Schema(description = "页码", example = "1", defaultValue = "1")
    private Integer pageNum = 1;

    /**
     * 每页大小
     */
    @Schema(description = "每页大小", example = "10", defaultValue = "10")
    private Integer pageSize = 10;

    /**
     * 联系人类型过滤：USER-用户，AGENT-数字员工，为空时查询所有类型
     */
    @Schema(description = "联系人类型过滤：USER-用户，AGENT-数字员工，为空时查询所有类型")
    private List<String> contactTypes;

    /**
     * 会话类型过滤：h_as-人与助手单聊，hs_as-群聊，h_h-人与人单聊，为空时查询所有类型
     */
    @Schema(description = "会话类型过滤：h_as-人与助手单聊，hs_as-群聊，h_h-人与人单聊，为空时查询所有类型")
    private List<String> sessionTypes;

    /**
     * 查询天数限制（最近N天内的联系人）
     */
    @Schema(description = "查询天数限制（最近N天内的联系人）", example = "30")
    private Integer daysLimit;
}
