package com.iwhalecloud.byai.common.feign.request.manager;

import java.util.List;
import java.util.Set;

import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ResourceOperQo {

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 每页大小
     */
    private Integer pageSize = 10;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源类型
     */
    private String resourceBizType;

    /**
     * 资源类型多选
     */
    private List<String> resourceTypeList;

    /**
     * 状态列表：0-草稿 1-待上架 2-已上架 3-已下架
     */
    private List<Integer> statusList;

    /**
     * 查看类型：1-我创建的 2-我管理的
     */
    private Integer ownershipType;

    /**
     * 用户id
     */
    private Long userId;

    private Set<Long> resourceIdList;

    /**
     * 资源来源ID列表(外部)
     */
    private List<Long> resourceSourcePkIdList;

    /**
     * 资源类型
     */
    private List<String> resourceBizTypeList;

    private Long enterpriseId;

    private Long catalogId;

    private boolean isFilterCreate;

    private String searchName;

    private Boolean isShare;

    private Boolean esQuery = false;

    private List<SortField> sortFields;

    private String suasSuperassistSubAgent;

    private List<String> systemCodes;

    private List<Long> catalogIds;
}
