package com.iwhalecloud.byai.manager.entity.system;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Getter
@Setter
@TableName("byai_system_feedback")
public class SystemFeedback {

    /**
     * 反馈ID
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 用户ID
     */
    private Long userId;

    /**
     * 反馈类型:BUG:bug,INQUIRY:测试,BUG:bug报告,SUGGESTION:功能建议,INQUIRY:使用咨询,OTHER:其他问题
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{systemfeedback.feedbacktype.notempty}")
    private String feedbackType;

    /**
     * 反馈标题
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{systemfeedback.title.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 100, message = "{systemfeedback.title.size}")
    private String title;

    /**
     * 反馈内容
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{systemfeedback.content.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 1000, message = "{systemfeedback.content.size}")
    private String content;

    /**
     * 联系信息
     */
    private String contactInfo;

    /**
     * 反馈状态
     */
    private String status;

    /**
     * 优先级
     */
    private Integer priority;

    /**
     * 系统版本
     */
    private String systemVersion;

    /**
     * 设备信息
     */
    private String deviceInfo;

    /**
     * IP地址
     */
    private String ipAddress;

    /**
     * 截图URL
     */
    private String screenshotUrl;

    /**
     * 创建时间
     */
    private Date createDate;

    /**
     * 更新时间
     */
    private Date updateDate;

    /**
     * 处理人ID
     */
    private Long processUserId;

    /**
     * 处理时间
     */
    private Date processDate;

    /**
     * 处理备注
     */
    private String processComment;
}
