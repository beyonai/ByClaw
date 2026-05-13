package com.iwhalecloud.byai.manager.qo.index;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-11 00:31:33
 * @description TODO
 */
@Getter
@Setter
public class DiscoverQo extends AuthQo {

    /**
     * 目录id
     */
    private Long catalogId;

    /**
     * 后端按 catalogId 展开后的当前目录及子目录 ID。
     */
    private List<Long> catalogIds;

    /**
     * 状态筛选维度，取值参见 {@link com.ztesoft.byai.assistantengine.domain.agent.enums.StatusFilterType}。
     */
    private String metaStatus;

    /**
     * 新增归属筛选维度，包含 “全部、全公司范围（全公司员工可访问）、组织范围（当前用户所属及相关部门可访问）、自定义范围（支持用户自主选择特定组织 / 人员范围）
     */
    private List<OrgFilterQo> orgFilters = new ArrayList<>();

    /**
     * 组织发布范围过滤
     */
    private Collection<Long> publishOrgIds;

    /**
     * 过滤资源归属类型
     */
    private String ownerType;

    /**
     * 排序标志字段,use:热门,focus:关注,createTime:创建时间,updateTime:更新时间
     */
    private String orderField = "use";

    /**
     * 排序方向，asc升序，desc降序
     */
    private String orderBy = "desc";

    /**
     * 查询指定授权数字员工
     */
    private Long resourceId;

    /**
     * 权限筛选：CREATED_BY_ME、AUTHORIZED_TO_ME、PENDING_MY_APPROVAL、APPLIED_BY_ME。
     * 与 SsResExtDigEmployeeMapper.selectDigitalEmployeeByQo 的 permission 字段语义一致。
     */
    private String permission;

    /**
     * 资源状态筛选：null=用 SQL 默认 status=2 兜底；2=已上架；3=已注销。
     * 与 selectPersonalDigitalEmployeeByQo 的 resourceStatus 字段语义一致。
     */
    private Long resourceStatus;

    /**
     * 是否查询全部资源状态。true 时不再附加 a.resource_status 过滤，覆盖筛选"全部"语义。
     */
    private Boolean includeAllResourceStatus;

}
