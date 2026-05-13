package com.iwhalecloud.byai.manager.qo.index;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 数字员工查询请求
 */
@Data
@Schema(name = "DigitEmployQo", description = "数字员工查询请求")
public class DigitEmployQo implements Serializable {
    /**
     * 分页码
     */
    @Schema(description = "分页码", example = "1", defaultValue = "1")
    private Integer pageNum = 1;

    /**
     * 分页大小
     */
    @Schema(description = "分页大小", example = "1000", defaultValue = "1000")
    private Integer pageSize = 1000;

    /**
     * 智能体名称模糊
     */
    @Schema(description = "智能体名称(模糊查询)", example = "金融")
    private String name;

    /**
     * 目录id （-1是我的关注，其他是目录）
     */
    @Schema(description = "目录ID", example = "123")
    private Long dirId;

    /**
     * 数字员工id列表
     */
    @Schema(description = "数字员工ID列表")
    private List<Long> digitEmployIdList;

    /**
     * 企业id
     */
    @Schema(description = "企业ID", example = "456")
    private Long enterpriseId;

    /**
     * focus、owner
     */
    @Schema(description = "类型", example = "focus", allowableValues = {
        "focus", "owner"
    })
    private String type;

    /**
     * 创建人
     */
    @Schema(description = "创建人ID", example = "789")
    private Long creator;

    /**
     * 0：草稿，1发布，2上架，3已下架
     */
    private List<Integer> metaStatusList;

    /**
     * 终端类型
     */
    private List<String> terminals;
}
