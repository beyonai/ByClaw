package com.iwhalecloud.byai.manager.qo.resource;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import lombok.Getter;
import lombok.Setter;
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
     * all:全部,authorize-授权给我,owner-我创建的,manager-管理
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
     * 资源发布类型：publish-公开发布，private-私有。
     * 给知识前端的通用查询入口使用；当前端不传时，默认按 publish 查询。
     */
    private String publishType;

    /**
     * 前端口径的发布状态。
     * 数字员工当前复用资源表 resource_status 做状态过滤；当前端不传时默认值为 0。
     */
    private Integer publishStatus;

}
