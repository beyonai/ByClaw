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

    @ApiModelProperty(value = "来源系统编码列表", required = false)
    private List<String> systemCodes;

    @ApiModelProperty(value = "目录ID", required = true)
    private Long catalogId;

    /**
     * 授权对象类型：USER、ORG、POST、STATION。
     */
    @ApiModelProperty(value = "授权对象类型", required = false)
    private String grantToObjType;

    /**
     * 授权对象标识。
     */
    @ApiModelProperty(value = "授权对象标识", required = false)
    private Long grantToObjId;

    /**
     * 后端按 catalogId 展开后的当前目录及子目录 ID。
     */
    private List<Long> catalogIds;

    /**
     * 状态：-1-已注销，0-草稿，1-待上架，2-已上架，3-已下架；null 时默认查询已上架，空字符串表示全部状态。
     */
    @ApiModelProperty(value = "资源状态", required = false)
    private String resourceStatus;

    /** 我的资源列表排除注销终态；在数据库分页前过滤，保持列表和总数一致。 */
    @ApiModelProperty(value = "是否排除已注销资源", required = false)
    private Boolean excludeDeleted;

    /**
     * 资源归属类型：enterprise-企业，personal-个人
     */
    @ApiModelProperty(value = "资源归属类型：enterprise-企业，personal-个人", required = false)
    private String ownerType;

    /** 我可用的页面按归属筛选时仍限定使用权限，不能切换为官方企业资源全量口径。 */
    @ApiModelProperty(value = "是否仅查询当前用户可用资源", required = false)
    private Boolean availableOnly;

    /**
     * 权限筛选：CREATED_BY_ME、AUTHORIZED_TO_ME、MANAGEABLE_BY_ME、MANAGED_BY_ME、PENDING_MY_APPROVAL、APPLIED_BY_ME。
     * MANAGEABLE_BY_ME 表示本人创建或授权本人管理的资源；MANAGED_BY_ME 排除本人创建的资源。
     * 两者均不因平台或组织管理员角色扩大范围，与数字员工“我的员工”的企业筛选保持一致。
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
