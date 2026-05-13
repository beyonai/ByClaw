package com.iwhalecloud.byai.manager.entity.men;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.alibaba.fastjson.annotation.JSONField;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 待办任务表
 */
@Getter
@Setter
@TableName("men_task")
public class MenTask {
    /** 主键标识 */
    @TableId(value = "task_id", type = IdType.INPUT)
    private Long taskId;

    /** 任务类型：APPROVE：审批，INPUT:用户协助输入，授权：AUTHORI */
    @NotBlank(groups = Add.class, message = "{mentaskdto.tasktype.notempty}")
    private String taskType;

    /** 消息标题 */
    @NotBlank(groups = Add.class, message = "{mentaskdto.title.notempty}")
    @Size(max = 200, message = "{mentaskdto.title.maxlength}")
    private String title;

    /** 消息内容 */
    @NotBlank(groups = Add.class, message = "{mentaskdto.content.notempty}")
    private String content;

    /** 关联资源组件标识 */
    private Long resComId;

    /** 任务输入对象 folder、file、 */
    private String fileOutType;

    /** 任务输出对象 */
    private String fileOut;

    /** 截止时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date taskDealineTime;

    /** 发送类型 HUMAN、AGENT、ASSITENT */
    private String sendType;

    /** 发送对象标识 */
    private Long sendObjId;

    /** 处理对象类型 HUMAN、AGENT、ASSITENT */
    private String dealType;

    /** 处理对象标识 */
    private Long dealObjId;

    /** 处理意见 */
    private String dealDesc;

    /** 会话标识 */
    private Long sessionId;

    /** 重派来源任务标识，任务重派场景 */
    private Long oriTaskId;

    /** 关联消息标识 */
    private Long messageId;

    /** 关联消息步骤标识 */
    private String messageStepCode;

    /** 任务状态 参考 MenTaskStatusEnum枚举 */
    @NotBlank(groups = Mod.class, message = "{mentaskdto.statuscd.notempty}")
    private String statusCd;

    /** 所属父任务 */
    private Long pTaskId;

    /** 外部任务标识 */
    private String taskExtId;

    /** 优先级:HIGH/MEDIUM/LOW */
    private String priority;

    /** 页面模板id */
    private String pageId;

    /** 来源系统编码 */
    private String systemNo;

    /** 登录通知地址 */
    private String loadSsoIframeUrl;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新人 */
    private Long updateBy;

    /** 更新时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /** 所属企业 */
    private Long comAcctId;

    // 资源发布的资源类型
    private String resourceBizType;

    // 资源id
    private Long resourceId;
}