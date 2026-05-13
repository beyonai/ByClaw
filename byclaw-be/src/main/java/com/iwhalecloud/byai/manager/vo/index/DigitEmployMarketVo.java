package com.iwhalecloud.byai.manager.vo.index;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-11-10 23:04:57
 * @description TODO
 */
@Getter
@Setter
public class DigitEmployMarketVo {

    /**
     * 主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 资源业务类型
     */
    private String resourceBizType;

    /**
     * 名称
     */
    private String name;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源归属类型
     */
    private String ownerType;

    /**
     * 头像
     */
    private String avatar;

    /**
     * 代理类型
     */
    private String agentType;

    /**
     * 首页地址
     */
    private String agentHomeUrl;

    /**
     * 分类ID
     */
    private Long catalogId;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 创建人ID
     */
    private Long creatorId;

    /**
     * 创建人名称
     */
    private String creatorName;

    /**
     * 审批状态
     */
    private String approveStatus;

    /**
     * 管理员用户ID
     */
    private String manUserId;

    /**
     * 管理员用户名称
     */
    private String manUserName;

    /***
     * 终端类型
     */
    private String terminal;

    /**
     * 是否打开超级助手
     */
    private String openSuperHelper;

    /**
     * 数字员工开场信息
     */
    private String prologue;

    /**
     * 集成方式
     */
    private String integrationType;

    /**
     * 智能体开发类型：byai/bot/dify/whaleAgent
     */
    private String agentDevType;

    /**
     * 创建类型
     */
    private String createType;

    /**
     * 所有授权管理者用户标识
     */
    private String manPrivIds;

    /**
     * 所有授权管理者权限的名称
     */
    private String manPrivNames;

    /**
     * 使用次数
     */
    private Long useCount = 0L;

    /**
     * 优先返回订阅的授权类型
     */
    private String grantType;

    /**
     * 关注数或者订阅数字
     */
    private Long focusCount = 0L;

    /**
     * 是否授权我
     */
    private boolean authorizeMe = false;

    /**
     * 是否拥有管理权限
     */
    private boolean managePermissions = false;

    /**
     * 是否本人创建
     */
    private boolean myCreate = false;

    /**
     * 是否拥有使用权限
     */
    private boolean usesPermissions = false;

    /**
     * 是否可编辑信息
     */
    private Boolean canEdit;

    /**
     * 是否可管理授权
     */
    private Boolean canManageAuth;

    /**
     * 是否可管理使用授权
     */
    private Boolean canUseAuth;

    /**
     * 是否可注销数据
     */
    private Boolean canDelete;

    /**
     * 是否可发起使用申请
     */
    private Boolean canApplyUse;

    /**
     * 是否可审核使用申请
     */
    private Boolean canAuditUse;

    /**
     * 资源标签：数字员工创建/设默认时按个人/默认助理写入；
     * 前端 ResourceCard 直接展示在卡片右上角。
     */
    private String tagName;

    /**
     * 关联技能标识列表，JSON字符串格式。
     */
    private String skills;

}
