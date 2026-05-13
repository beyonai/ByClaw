package com.iwhalecloud.byai.manager.dto.searchask;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-11 09:23:43
 * @description TODO
 */
@Getter
@Setter
public class SelectedDatasetDto {

    private List<Long> resourceIds;

    private Long sessionId;

    private Long agentId;

    /**
     * 企业知识库:ENTERPRISE_KB,个人知识库:PERSONAL_KB
     */
    private String dirType;

}
