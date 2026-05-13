package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.common.vo.SortField;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import lombok.Data;

/**
 * 资源查询请求DTO
 */
@Data
public class ResourceQueryRequest {

    private Long resourceId;

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
     * 资源类型
     */
    private List<String> resourceBizTypeList = new ArrayList<>();

    /**
     * 资源类型多?
     */
    private List<String> resourceTypeList = new ArrayList<>();


    /**
     * 项目空间
     */
    private String pid;

    /**
     * 状态列表：0-草稿 1-待上架（待审核） 2-已上架（审核通过?3-已下架4-审核未通过
     */
    private List<Integer> statusList;

    /**
     * 查看类型-全部 1-我创建的 2-我管理的 3-我能使用?
     */
    private Integer ownershipType = 0;

    /**
     * 用户id
     */
    private Long userId;

    private Long enterpriseId;

    /**
     * 资源id列表
     */
    private Set<Long> resourceIdList;

    /**
     * 资源来源ID列表(外部)
     */
    private List<Long> resourceSourcePkIdList;

    /**
     * 上架目录ID
     */
    private Long catalogId;

    private List<Long> catalogIds;

    /**
     * 排序字段列表
     */
    private List<SortField> sortFields;

    private String sortField;

    private String sortOrder;

    /**
     * 是否过滤创建，true: 过滤掉自己创建的
     */
    private boolean isFilterCreate;

    private boolean isShare;

    private boolean esQuery = false;

    /**
     * 权限id列表
     */
    private List<Long> grantToIdList;

    /**
     * 知识库或者技能标?
     */
    private String suasSuperassistSubAgent;

    /**
     * 是不是管理员
     */
    private String suasSuperassistSubAgentAdmin;

    /**
     * 系统编码查询
     */
    private List<String> systemCodes;



    /**
     * 获取资源类型列表，若为 null 则返回空列表（避免 NPE）
     */
    public List<String> getResourceTypeList() {
        if (resourceTypeList == null) {
            resourceTypeList = new ArrayList<>();
        }
        return resourceTypeList;
    }


    public List<String> getResourceBizTypeList() {
        if (resourceBizTypeList == null) {
            resourceBizTypeList = new ArrayList<>();
        }
        return resourceBizTypeList;
    }

}