package com.iwhalecloud.byai.state.common.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 最终答案或者推理过程的增量信息(a2a组件part)，每个增量信息可以是：1)文本（推理/答案）2)卡片(推理/答案)3)视频(推理/答案)4)图像(推理/答案)5)文件(推理/答案)
 */
@Getter
@Setter
public class AnswerDelta {

    // 内容类型：文本(a2a的text-part)、卡片(a2a的data-part)、视频/图像/文件（a2a的file-part）等
    private String contentType;

    private Long messageId;

    private Long taskId;

    private String stepId;

    private Long created;

    private String model;

    private String id;

    // 具体的内容(目前主要是一个消息)：文本是string, 卡片是json, 视频/图像是base64, 文件引用是json
    private List<ChoiceDto> choices;

    // ? 这个用来做什么
    private String object;

    private String objectType;

    // 关联资源标识这里会返回给前端包含(子任务id，资源id)如果是子任务的时候这个先放入值，给到response操作的setmenres
    private String resComIds;

    private String agentId;

    // 追问元数据
    private String metadata;

    private String orderId;

    private String parentOrderId;

    private String sourceAgentType;

    private String status;
}
