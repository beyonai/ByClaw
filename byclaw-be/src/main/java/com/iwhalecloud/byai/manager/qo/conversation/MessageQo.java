package com.iwhalecloud.byai.manager.qo.conversation;

import java.util.List;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class MessageQo {

    /**
     * relId列表 用于选中消息的ID列表
     */
    private List<Long> relIdList;

    /**
     * 是否全选中 (默认false/null)
     * false:全选中 true:未全选中
     * 如果全选中则走下面的查询条件的逻辑
     * 如果未全选中则走relIdList的逻辑
     */
    private Boolean isAllNotSelect;

    /**
     * 来源渠道
     */
    private List<Long> projectId;

    /**
     * 来源终端
     */
    private List<String> accessTerminal;

    /**
     * 对话起始时间
     */
    private String startTime;

    /**
     * 对话结束时间
     */
    private String endTime;

    /**
     * 对话用户
     */
    private List<Long> creatorId;

    /**
     * 反馈类型
     */
    private String feedbackType;

    /**
     * 反馈标签
     */
    private List<String> feedbackLabel;

    /**
     * 反馈评分
     */
    private List<Float> feedbackScore;

    /**
     * 用户提问-用于模糊查询--messageContent
     */
    private String userQuestion;

    /**
     * 页码
     */
    @NotNull(message = "{messageqo.page.notnull}")
    private Integer pageIndex;

    /**
     * 页大小
     */
    @NotNull(message = "{messageqo.pageSize.notnull}")
    private Integer pageSize;

    /**
     * 对象类型
     */
    @NotNull(message = "{messageqo.objectType.notnull}")
    private String objType;


    /**
     * 回复对象id列表
     */
    private List<Long> resObjIdList;

    private String keyword;
}
