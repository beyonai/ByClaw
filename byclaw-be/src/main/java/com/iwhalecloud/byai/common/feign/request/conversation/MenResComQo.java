package com.iwhalecloud.byai.common.feign.request.conversation;

import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-11-29 14:41:13
 * @description TODO
 */
@Getter
@Setter
public class MenResComQo {

    /** 主键标识 */
    private Long resComId;

    /** 对应前端的contentType枚举类型；2011：bot动态解释卡片2010:ui-agent卡片2001:图表卡片 */
    private Integer resType;

    /** 构建内容json */
    private String resPage;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    private Date createTime;

    /** 更新人 */
    private Long updateBy;

    /** 更新时间 */
    private Date updateTime;

    /** 所属企业 */
    private Long comAcctId;

    /**
     * 消息id, 通知数字员工才需要传递
     */
    private Long messageId;

    /**
     * 任务 id, 通知数字员工才需要传递
     */
    private Long taskId;
}
