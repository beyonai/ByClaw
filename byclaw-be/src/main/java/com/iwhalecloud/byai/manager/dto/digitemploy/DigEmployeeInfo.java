package com.iwhalecloud.byai.manager.dto.digitemploy;


import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DigEmployeeInfo {

    private Long resourceId;

    /**
     * 归属组织
     */
    private String orgName;

    /**
     * 业务领域
     */
    private String catalogName;

    /**
     * 管理人员
     */
    private String manUserName;


    private Double score;

    /**
     * 关联热能
     */
    private List<Long> relIds;

    /**
     * 详情关联资源标识
     */
    private List<SsResourceDTO> relResourceList;
}
