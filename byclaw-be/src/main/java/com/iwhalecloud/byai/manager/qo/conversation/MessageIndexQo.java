package com.iwhalecloud.byai.manager.qo.conversation;

import java.time.LocalDateTime;
import java.util.List;

import lombok.Data;

/**
 * 消息索引查询请求实体
 */
@Data
public class MessageIndexQo {

    /**
     * 页码
     */
    private Integer pageNum;

    /**
     * 每页大小
     */
    private Integer pageSize;

    /**
     * 任务ID列表
     */
    private List<Long> taskIds;

    /**
     * 项目ID列表
     */
    private List<Long> projectIds;

    /**
     * 企业账户ID列表
     */
    private List<Long> comAcctIds;

    /**
     * 回复对象类型列表
     */
    private List<String> resObjTypes;

    /**
     * 回复对象ID列表
     */
    private List<Long> resObjIds;

    /**
     * 回复来源终端列表
     */
    private List<String> resAccessTerminals;

    /**
     * 回复内容向量
     */
    private List<Double> resContentVector;

    /**
     * 回复时间范围
     */
    private List<String> resTimeRange;

    /**
     * 提问对象ID列表
     */
    private List<Long> askObjIds;

    /**
     * 提问对象类型列表
     */
    private List<String> askObjTypes;

    /**
     * 提问来源终端列表
     */
    private List<String> askAccessTerminals;

    /**
     * 提问内容
     */
    private String askContent;

    /**
     * 提问内容向量
     */
    private List<Double> askContentVector;

    /**
     * 提问时间范围
     */
    private List<String> askTimeRange;

    /**
     * 反馈类型
     */
    private String feedbackType;

    /**
     * 反馈标签列表
     */
    private List<String> feedbackLabels;

    /**
     * 反馈评分范围
     */
    private List<Float> feedbackScoreRange;

    /**
     * 反馈时间范围
     */
    private List<String> feedbackTimeRange;

    /**
     * 任务耗时范围
     */
    private List<Float> taskDueTimeRange;

    /**
     * 请求状态列表
     */
    private List<Integer> requestStatuses;

    /**
     * 创建时间范围
     */
    private List<LocalDateTime> createTimeRange;

    /**
     * 向量相似度阈值
     */
    private Double vectorSimilarityThreshold;

    /**
     * relId列表 用于选中消息的ID列表
     */
    private List<Long> relIdList;

    /**
     * 是否全选中
     * false:全选中 true:未全选中
     * 如果全选中则走下面的查询条件的逻辑
     * 如果未全选中则走relIdList的逻辑
     */
    private Boolean isAllNotSelect;

    /**
     * 排序字段
     */
    private String sortField;

    /**
     * 排序方向
     */
    private String sortDirection;

    private String keyword;
}