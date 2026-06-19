package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/**
 * 个人 agent tar.gz 档案入参。
 *
 * @author qin.guoquan
 * @date 2026-05-21
 */
@Data
public class PersonalAgentArchiveQo {

    /**
     * 资源ID。
     */
    private Long resourceId;

    /**
     * tar.gz 文件路径，例如 /.personal-agents/10000417/demo.tar.gz。
     * 查询列表时不需要传。
     */
    private String archivePath;

    /**
     * 可选关键字，查询列表时按文件名模糊匹配。
     */
    private String keyword;

    /**
     * 目标用户编码；留空则使用当前登录用户。
     */
    private String userCode;
}
