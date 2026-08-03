package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 运营项目绑定的第三方平台账号。 */
@Getter
@Setter
@TableName("byai_project_account")
public class OperationAccount {

    @TableId(value = "account_id", type = IdType.INPUT)
    private Long accountId;

    private Long projectId;

    private String platformCode;

    private String accountCode;

    private String accountName;

    /** 连接状态：connected 或 disconnected。 */
    private String status;

    /** 登录状态：online 或 offline。 */
    private String loginStatus;

    private String config;

    private String metrics;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    /** 状态编码：00A 有效，00X 无效。 */
    private String statusCd;
}
