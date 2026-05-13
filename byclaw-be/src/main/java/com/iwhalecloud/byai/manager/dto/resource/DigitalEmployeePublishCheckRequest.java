package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 数字员工发布检查请求
 */
@Getter
@Setter
public class DigitalEmployeePublishCheckRequest {

    /**
     * 数字员工ID
     */
    private Long resourceId;

    /**
     * 类型：handleAuth-授权；publish-发布
     */
    private String type;

    /**
     * 发布或授权时传组织的ID列表
     */
    private List<String> manOrgIdList;

    /**
     * 授权时传授权的人员ID列表
     */
    private List<String> userIdList;
}
