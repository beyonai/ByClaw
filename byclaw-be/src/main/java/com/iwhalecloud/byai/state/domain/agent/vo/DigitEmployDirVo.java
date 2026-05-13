package com.iwhalecloud.byai.state.domain.agent.vo;

import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/26
 */
@Data
public class DigitEmployDirVo {
    /**
     * 目录id
     */
    private Long catalogId;

    /**
     * 目录名称
     */
    private String dirName;

    /**
     * 目录描述
     */
    private String dirDesc;

    /**
     * 目录父级id
     */
    private Long parentDirId;
}
