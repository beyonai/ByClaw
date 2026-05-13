package com.iwhalecloud.byai.manager.domain.resource.request;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import java.io.Serializable;
import java.util.List;

@Data
@ApiModel(description = "我能使用的资源列表查询请求")
public class ResourceUseAuthQo extends AuthQo implements Serializable {

    /**
     * 资源类型
     */
    @ApiModelProperty(value = "资源类型", required = true)
    private List<String> resourceBizTypeList;

    @ApiModelProperty(value = "目录ID", required = true)
    private Long catalogId;

    /**
     * 后端按 catalogId 展开后的当前目录及子目录 ID。
     */
    private List<Long> catalogIds;

    /**
     * 状态：0-草稿，2-已上架，3-已下架；null 时默认查询已上架，空字符串表示全部状态。
     */
    @ApiModelProperty(value = "资源状态", required = false)
    private String resourceStatus;

    /**
     * 资源归属类型：enterprise-企业，personal-个人
     */
    @ApiModelProperty(value = "资源归属类型：enterprise-企业，personal-个人", required = false)
    private String ownerType;

    /**
     * 权限筛选：CREATED_BY_ME、AUTHORIZED_TO_ME、PENDING_MY_APPROVAL、APPLIED_BY_ME。
     */
    @ApiModelProperty(value = "权限筛选", required = false)
    private String permission;

    /**
     * 归属筛选：ALL、COMPANY、DEPT。
     */
    @ApiModelProperty(value = "归属筛选", required = false)
    private String belong;

    /**
     * 组织归属筛选。
     */
    @ApiModelProperty(value = "组织归属筛选", required = false)
    private List<OrgFilterQo> orgFilters;

    /**
     * 后端展开后的归属组织 ID。
     */
    private List<Long> publishOrgIds;

    /**
     * 是否额外包含 owner_type = personal_default 的默认资源。
     *
     * 仅在“个人知识库 / 个人数字员工”这类前端查询场景下由控制层自动开启，
     * 前端无需主动传入。
     */
    private Boolean includeDefaultOwnerType;

    /**
     * 当前用户绑定的默认个人资源 ID。
     *
     * 个人知识库场景对应 suas_superassist.session_dataset_id；
     * 个人助理场景对应 suas_superassist.default_dig_employee_id。
     */
    private Long defaultPersonalResourceId;

    /**
     * 是否按“平台全部企业资源”口径查询。
     *
     * 仅在企业知识库查询场景下由控制层自动开启，前端无需主动传入。
     */
    private Boolean includeAllEnterpriseOwnerType;
}
