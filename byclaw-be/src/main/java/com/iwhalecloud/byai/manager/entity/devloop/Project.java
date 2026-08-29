package com.iwhalecloud.byai.manager.entity.devloop;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_project")
public class Project {

    @TableId(value = "project_id", type = IdType.INPUT)
    private Long projectId;

    private String projectName;

    private String description;

    private Long resourceId;

    /** 云盘知识库资源ID */
    private Long cloudResourceId;

    /** 项目类型：normal普通项目，develop研发项目 */
    private String projectType;

    /** 是否分享：N-不分享，Y-可分享 */
    private String isShare;

    /**
     * 研发项目工作区初始化状态：ready已就绪(默认,存量/普通项目均视为就绪)、pending待初始化、initializing初始化中。
     * 仅 develop 项目在未 ready 前禁止建需求/启动任务。
     */
    private String initStatus;

    /** 是否建索引：Y建立，N不建立(默认)。研发项目初始化配置。 */
    private String buildIndex;

    /** 建索引所需技能包，逗号分隔(如 trellis,superpowers)。 */
    private String indexSkills;

    /**
     * 工作区初始化会话ID：架构数字员工的那条会话。 轮询按此会话读 /by/.acp-runs/sessions/&lt;会话ID&gt;.json 判完成，没有它就不知道该读哪个状态文件。
     */
    private Long initSessionId;

    /** 上次初始化失败/超时原因：pending 态回显给用户，重新下发初始化时清空。 */
    private String initFailReason;

    private Long createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    private Long updateBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    private String deleteFlag;
}
