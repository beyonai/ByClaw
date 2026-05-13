package com.iwhalecloud.byai.manager.vo.resource;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工评估旧数据表
 */
@Getter
@Setter
public class SsResExtEvaluateVO {

    /**
     * 数字员工资源ID：关联数字员工的核心标识，用于关联查询对应评估数据
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 评估执行时间：记录该次评估实际执行的时间戳
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime evaluateTime;

    /**
     * 测试集回答准确率：百分比格式，存储测试集上的回答准确比例（如85.00代表85%）
     */
    private BigDecimal testSetAccuracy;

    /**
     * 实际使用回复准确率：百分比格式，存储生产环境实际使用中的回复准确比例（如85.00代表85%）
     */
    private BigDecimal actualUseAccuracy;

    /**
     * 对话异常率：百分比格式，存储对话过程中出现异常的比例（如5.00代表5%）
     */
    private BigDecimal conversationErrorRate;

    /**
     * 平均首词响应时长：单位为秒，存储对话中首次回复的平均耗时（如23.00代表23秒）
     */
    private BigDecimal avgFirstResponseDuration;

    /**
     * 人设描述规范度：百分比格式，存储数字员工人设描述符合规范的比例（如88.00代表88%）
     */
    private BigDecimal personaSpecificationScore;

    /**
     * 能力描述与岗位匹配度：百分比格式，存储数字员工能力与对应岗位需求的匹配比例（如92.00代表92%）
     */
    private BigDecimal abilityPostMatchingScore;

    /**
     * 是否符合上岗要求：0表示不符合，1表示符合，默认值为0
     */
    private Integer isQualifiedForPost;

    /**
     * 评估结果详情：记录各项指标的评估结果和不符合原因
     */
    private String evaluateResult;

    /**
     * 构造方法，默认赋值resourceId，评估时间为null，默认其他的都是0.0
     *
     * @param resourceId 数字员工资源ID
     */
    public SsResExtEvaluateVO(Long resourceId) {
        this.resourceId = resourceId;
        this.evaluateTime = LocalDateTime.now();
        this.testSetAccuracy = BigDecimal.valueOf(0.0);
        this.actualUseAccuracy = BigDecimal.valueOf(0.0);
        this.conversationErrorRate = BigDecimal.valueOf(0.0);
        this.avgFirstResponseDuration = BigDecimal.valueOf(0.0);
        this.personaSpecificationScore = BigDecimal.valueOf(0.0);
        this.abilityPostMatchingScore = BigDecimal.valueOf(0.0);
        this.isQualifiedForPost = 0;
    }

}