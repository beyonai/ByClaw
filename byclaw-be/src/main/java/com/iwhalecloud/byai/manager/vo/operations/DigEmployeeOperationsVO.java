package com.iwhalecloud.byai.manager.vo.operations;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * 数字员工运营信息VO
 * 用于返回数字员工的基本信息和关联资源
 *
 * @author zzh
 */
@Getter
@Setter
public final class DigEmployeeOperationsVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源业务类型
     */
    private String resourceBizType;

    /**
     * 管理用户 字符串分割
     */
    private String manUserId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 用户名称 用逗号分割
     */
    private String userName;

    /**
     * 目录名称
     */
    private String catalogName;

    /**
     * 岗位ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long positionId;

    /**
     * 岗位名称
     */
    private String positionName;

    /**
     * 分数
     */
    private Double targetQuality;

    /**
     * 技能列表（resource_biz_type = DIG_EMPLOYEE、AGENT、TOOL、MCP、VIEW、OBJECT、MCP_TOOL）
     */
    private List<RelResourceVO> skillList;

    /**
     * 知识库列表（resource_biz_type = KG_QA、KG_DOC、KG_DB、KG_TERM）
     */
    private List<RelResourceVO> knowledgeList;

    /**
     * 规范性指标-能力描述与岗位匹配度 百分比 0~100%
     */
    private Double capabilityMatch;

    /**
     * 上岗状态 未上岗-0、上岗审核中-1、拒绝上岗-2、已上岗-3
     */
    private Integer onDutyStatus;

    /**
     * 上岗时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date onJobTime;

    /**
     * 能力与岗位匹配度百分比 0~100%
     */
    private Double capabilityMatchPercent;

}

