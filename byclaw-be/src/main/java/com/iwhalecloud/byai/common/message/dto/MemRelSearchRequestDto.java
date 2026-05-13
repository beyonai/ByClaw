package com.iwhalecloud.byai.common.message.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 消息关联搜索请求DTO
 * 基于message_index表结构的搜索参数
 *
 * @author smartcloud
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MemRelSearchRequestDto {

    // ===== 分页参数 =====

    /**
     * 页码，从1开始
     */
    private Integer pageNum = 1;

    /**
     * 每页大小
     */

    private Integer pageSize = 20;

    // ===== 基础查询参数 =====

    /**
     * 任务ID列表
     */
    private List<Long> taskIds;

    /**
     * 会话ID列表
     */
    private List<Long> sessionIds;

    /**
     * 项目ID列表 - 来源渠道
     */
    private List<Long> projectIds;

    /**
     * 企业账户ID列表
     */
    private List<Long> comAcctIds;

    // ===== 回复相关查询参数 =====

    /**
     * 回复对象类型列表
     * 支持: HUMAN, AGENT, SUASS
     */
    private List<String> resObjTypes;

    /**
     * 回复对象标识列表
     */
    private List<Long> resObjIds;

    /**
     * 回复来源终端列表
     * 支持: WEB, MOBILE, API, DESKTOP, MINIAPP
     */
    private List<String> resAccessTerminals;

    /**
     * 回复消息向量 - 用于向量相似度搜索
     */
    private List<Float> resContentVector;

    /**
     * 回复时间范围 - [开始时间, 结束时间]
     */

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private List<LocalDateTime> resTimeRange;

    // ===== 提问相关查询参数 =====

    /**
     * 提问对象标识列表
     */
    private List<Long> askObjIds;

    /**
     * 提问对象类型列表
     * 支持: HUMAN, AGENT, SUASS
     */
    private List<String> askObjTypes;

    /**
     * 提问来源终端列表
     * 支持: WEB, MOBILE, API, DESKTOP, MINIAPP
     */
    private List<String> askAccessTerminals;
    /**
     * 回复消息内容 - 支持全文检索
     */
    private String resContent;
    /**
     * 提问消息内容 - 支持全文检索
     */
    private String askContent;

    /**
     * 提问消息向量 - 用于向量相似度搜索
     */
    private List<Float> askContentVector;

    /**
     * 提问时间范围 - [开始时间, 结束时间]
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private List<LocalDateTime> askTimeRange;

    // ===== 反馈相关查询参数 =====

    /**
     * 反馈类型 - 精确查询
     * 支持: LIKE, DISLIKE, SCORE, COMMENT
     */
    private String feedbackType;

    /**
     * 反馈标签列表 - 数组交集查询
     * 如果查询标签与记录标签有交集则命中
     */
    private List<String> feedbackLabels;

    /**
     * 反馈评分范围 - [最小评分, 最大评分]
     */
    private List<Float> feedbackScoreRange;

    /**
     * 反馈时间范围 - [开始时间, 结束时间]
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private List<LocalDateTime> feedbackTimeRange;

    // ===== 任务相关查询参数 =====

    /**
     * 请求耗时范围 - [最小耗时, 最大耗时] (秒)
     */
    private List<Float> taskDueTimeRange;

    /**
     * 请求状态列表
     * 0: 成功, -1: 失败
     */
    private List<Integer> requestStatuses;

    // ===== 时间相关查询参数 =====

    /**
     * 创建时间范围 - [开始时间, 结束时间]
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private List<LocalDateTime> createTimeRange;

    // ===== 搜索控制参数 =====

    /**
     * 向量搜索相似度阈值 (0.0-1.0)
     */
    private Float vectorSimilarityThreshold = 0.7f;



    /**
     * 排序字段
     */
    private String sortField = "createTime";

    /**
     * 排序方向 (ASC/DESC)
     */
    private String sortDirection = "DESC";

    private List<String> askMsgIds;

    private List<String> resMsgIds;

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

    private String keyword;
}
