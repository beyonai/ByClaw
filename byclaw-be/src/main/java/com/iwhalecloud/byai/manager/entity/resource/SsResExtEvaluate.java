package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 数字员工评估旧数据表
 */
@Getter
@Setter
@Builder
@TableName("ss_res_ext_evaluate")
@AllArgsConstructor
@NoArgsConstructor
public class SsResExtEvaluate {

    /**
     * 评估记录ID：唯一标识每条评估记录，便于数据查询与维护
     */
    @TableId(value = "evaluate_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long evaluateId;

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
     * 评估结果
     */
    private String evaluateResult;

    /**
     * 创建人：记录该条评估数据的录入操作人
     */
    private String createBy;

    /**
     * 数据创建时间：默认当前时间戳，记录数据入库的时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime createTime;

    /**
     * 数据更新时间：记录该条评估数据最后一次修改的时间戳
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime updateTime;
}