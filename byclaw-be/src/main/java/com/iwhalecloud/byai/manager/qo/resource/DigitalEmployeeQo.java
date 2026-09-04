package com.iwhalecloud.byai.manager.qo.resource;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import lombok.Getter;
import lombok.Setter;
import java.util.Collection;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-29 01:20:22
 * @description TODO
 */
@Getter
@Setter
public class DigitalEmployeeQo extends AuthQo {

    /**
     * 数字员工类型。017 表示数字员工组；未传时保持历史接口语义并排除 017。
     */
    private String agentType;

    /**
     * 数字员工归属类型：enterprise 为企业员工；未传时个人员工组可同时查询个人和企业员工。
     */
    private String ownerType;

    /**
     * all:全部,authorize-授权给我,owner-我创建的,manager-管理,managerExcludingOwner-授权我管理且非我创建,
     * manageable-我创建的或我能管理的
     */
    private String type;

    private List<Long> catalogIds;

    private Long catalogId;

    private Long resourceStatus;

    /**
     * 是否查询全部资源状态。
     */
    private Boolean includeAllResourceStatus;

    /**
     * 权限筛选：CREATED_BY_ME、AUTHORIZED_TO_ME、PENDING_MY_APPROVAL、APPLIED_BY_ME。
     */
    private String permission;

    /**
     * 归属筛选：ALL、COMPANY、DEPT。
     */
    private String belong;

    /**
     * 组织归属筛选。
     */
    private List<OrgFilterQo> orgFilters;

    /**
     * 后端展开后的归属组织 ID。
     */
    private List<Long> publishOrgIds;

    private List<String> systemCodes;

    /**
     * 当前会话绑定的默认个人助理数字员工 ID。
     */
    private Long defaultDigEmployeeId;

    /**
     * 当前用户默认超级助手资源编码，固定为 {userCode}_main。
     */
    private String defaultSuperAssistantResourceCode;

    /**
     * 安装目标查询时用于判断数字员工是否已经安装指定资源。
     */
    private Long relResourceId;

    /**
     * 资源发布类型：publish-公开发布，private-私有。
     * 给知识前端的通用查询入口使用；当前端不传时，默认按 publish 查询。
     */
    private String publishType;

    /**
     * 前端口径的发布状态。
     * 数字员工当前复用资源表 resource_status 做状态过滤；当前端不传时默认值为 0。
     */
    private Integer publishStatus;

    /** 当前数字员工组成员候选查询所属企业。 */
    private Long memberCandidateEnterpriseId;

    /** 当前用户是否拥有全局资源管理权限。 */
    private Boolean memberCandidateGlobalManager;

    /** 允许加入数字员工组的数字员工类型。 */
    private Collection<String> memberCandidateAgentTypes;

    /** 允许加入数字员工组的第三方接入类型。 */
    private Collection<String> memberCandidateIntegrationTypes;

    /** 当前用户驻地及其上级驻地，用于批量判断管理授权。 */
    private Collection<Long> memberCandidateStationIds;

}
