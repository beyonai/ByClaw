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
public class MemRelSearchReponseDto {
 /**
     * 关联ID - 主键
     */
    private Long relId;
    
    /**
     * 消息任务标识
     * 对应请求终端+"_" + requestID，但要保证唯一
     */
    private Long taskId;
    
    /**
     * 会话ID
     */
    private Long sessionId;
    
    // ===== 提问相关字段 =====
    
    /**
     * 提问消息标识
     */
    private Long askMsgId;
    
    /**
     * 提问消息内容
     */
    private String askContent;

    
    /**
     * 提问消息标签数组
     * 例如: ["喜欢", "不准确"]
     */
    private List<String> askContentTags;
    
    /**
     * 提问来源终端
     */
    private String askAccessTerminal;
    
    /**
     * 提问对象类型
     * 人员：HUMAN，数字员工：AGENT，超级助理：SUASS
     */
    private String askObjType;
    
    /**
     * 提问对象标识
     */
    private Long askObjId;
    
    /**
     * 提问时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime askTime;
    
    // ===== 回复相关字段 =====
    
    /**
     * 回复消息标识
     */
    private Long resMsgId;
    
    /**
     * 回复消息内容
     */
    private String resContent;
    

    
    /**
     * 回复消息标签
     * 例如: ["喜欢", "不准确"]
     */
    private List<String> resContentTags;
    
    /**
     * 回复来源终端
     */
    private String resAccessTerminal;
    
    /**
     * 回复对象类型
     * 人员：HUMAN，数字员工：AGENT，超级助理：SUASS
     */
    private String resObjType;
    
    /**
     * 回复对象标识
     */
    private Long resObjId;
    
    /**
     * 回复时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime resTime;
    
    // ===== 反馈相关字段 =====
    
    /**
     * 用户反馈类型
     */
    private String feedbackType;
    
    /**
     * 用户反馈标签，逗号分隔
     */
    private List<String> feedbackLabel;
    
    /**
     * 用户反馈评分
     */
    private Float feedbackScore;
    
    /**
     * 用户反馈内容
     */
    private String feedbackContent;
    
    /**
     * 反馈时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime feedbackTime;
    
    // ===== 状态和其他字段 =====
    
    /**
     * 问答状态
     * 成功：0，失败：-1
     */
    private Integer requestStatus;
    
    /**
     * 请求耗时(秒)
     */
    private Float taskDueTime;


   /**
    * 首词响应时长(秒)
    */
   private Float firstTextDuration;
    
    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;
    
    /**
     * 来源渠道/项目标识
     */
    private Long projectId;
    
    /**
     * 所属企业
     */
    private Long comAcctId;
    
    // ===== 响应特有字段 =====
    
    /**
     * 操作结果状态
     * true: 成功, false: 失败
     */
    private Boolean success;
    
    /**
     * 操作结果消息
     */
    private String message;
    
    /**
     * 响应时间戳
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime responseTime;

    /**
     * 提问消息向量
     */
    private Object askContentVector;


    /**
     * 回复消息向量
     */
    private Object resContentVector;


    /**
     * 是否处理
     */
    private Integer isHandle;


}
