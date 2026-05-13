package com.iwhalecloud.byai.state.interfaces.controller.showcase.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.Getter;
import lombok.Setter;

/**
 * 成果空间更新请求
 *
 * @author system
 * @date 2025-11-10
 */
@Setter
@Getter
public class ShowcaseUpdateRequest {

    /**
     * 主键
     */
    @NotNull(message = "成果空间ID不能为空")
    private Long id;

    /**
     * 会话id
     */
    private Long sessionId;

    /**
     * 类型，ppt,text,chat等前端保存的类型
     */
    @Size(max = 64, message = "成果空间类型长度不能超过64字符")
    private String type;

    /**
     * 智办任务Id
     */
    private Long taskId;

    /**
     * 内容
     */
    @Size(max = 4000, message = "成果空间内容长度不能超过4000字符")
    private String content;

    /**
     * 文件状态：1-有效；0-无效
     */
    private Integer status;

    /**
     * 成果文件访问地址
     */
    @Size(max = 1024, message = "成果文件地址长度不能超过1024字符")
    private String url;


    /**
     * 对象存储文件编码
     */
    @Size(max = 128, message = "文件编码长度不能超过128字符")
    private String fileCode;


    /**
     * 对象存储文件ID
     */
    @Size(max = 128, message = "文件ID长度不能超过128字符")
    private String fileId;

    /**
     * 特殊数字员工id
     */
    private Long agentId;

    /**
     * 数字员工唯一标识code--byai_tag_relation
     */
    @Size(max = 128, message = "数字员工唯一标识长度不能超过128字符")
    private String agentCode;


    /**
     * 文件名字/目录名字
     */
    @NotBlank(message = "成果空间名称不能为空")
    @Size(max = 256, message = "成果空间名称长度不能超过256字符")
    private String name;

    /**
     * 当前消息Id
     */
    private Long messageId;


    /**
     * 会话模式
     */
    @Size(max = 64, message = "会话模式长度不能超过64字符")
    private String sessionMode;
}


