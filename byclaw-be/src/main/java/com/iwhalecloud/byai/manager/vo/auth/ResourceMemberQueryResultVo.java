package com.iwhalecloud.byai.manager.vo.auth;

import com.alibaba.fastjson.JSONObject;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源成员查询结果
 */
@Getter
@Setter
public class ResourceMemberQueryResultVo {

    /**
     * 资源真实业务类型
     */
    private String resourceBizType;

    /**
     * 根据资源类型返回的资源扩展子表信息
     */
    private JSONObject extInfo;

    /**
     * 有效管理人员/组织/岗位/驻地
     */
    private List<ResourceMemberItemVo> managerList = new ArrayList<>();

    /**
     * 管理黑名单
     */
    private List<ResourceMemberItemVo> managerBlackList = new ArrayList<>();

    /**
     * 有效使用人员/组织/岗位/驻地
     */
    private List<ResourceMemberItemVo> useList = new ArrayList<>();

    /**
     * 使用黑名单
     */
    private List<ResourceMemberItemVo> useBlackList = new ArrayList<>();
}
