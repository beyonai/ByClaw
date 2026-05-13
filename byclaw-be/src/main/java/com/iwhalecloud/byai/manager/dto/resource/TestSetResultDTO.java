package com.iwhalecloud.byai.manager.dto.resource;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 测试集结果DTO
 */
@Data
@Schema(description = "测试集结果")
public class TestSetResultDTO {

    /**
     * 提问内容
     */
    @Schema(description = "提问内容")
    private String questionContent;

    /**
     * 回复内容
     */
    @Schema(description = "回复内容")
    private String responseContent;

    /**
     * 结果判断（转换后的描述：回答正确，回答错误）
     */
    @Schema(description = "结果判断（回答正确，回答错误）")
    private String resultDescription;

    /**
     * 结果判断（0：错误，1：正确）
     */
    @Schema(description = "结果判断（0：错误，1：正确）")
    private Integer resultCode;

    /**
     * 原因
     */
    @Schema(description = "原因")
    private String reason;
}
