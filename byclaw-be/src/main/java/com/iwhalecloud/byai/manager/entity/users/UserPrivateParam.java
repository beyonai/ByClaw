package com.iwhalecloud.byai.manager.entity.users;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人参数配置。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@Getter
@Setter
@TableName("po_user_private_param")
public class UserPrivateParam {

    @TableId
    private Long paramId;

    private Long userId;

    private String paramKey;

    private String paramValueCipher;

    private String paramValueLast4;

    private String description;

    private String status;

    /** 参数来源：USER 用户维护，CONNECTOR 连接器服务托管 */
    private String paramSource;

    /** 来源业务标识；连接器托管参数保存 connectorCode */
    private String sourceRef;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
