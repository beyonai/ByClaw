package com.iwhalecloud.byai.manager.vo.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 数字员工评估比对VO
 * 包含基准值和评估值，用于评估结果比对
 */
@Getter
@Setter
public class SsResExtEvaluateCompareVO {

    /**
     * 基准值VO（系统配置的标准值）
     */
    private SsResExtEvaluateVO standardVO;

    /**
     * 评估值VO（实际评估结果值）
     */
    private SsResExtEvaluateVO evaluateVO;

    /**
     * 是否符合上岗要求：0表示不符合，1表示符合，默认值为0
     */
    private Integer isQualifiedForPost;

    /**
     * 评估结果描述
     */
    private String evaluateResult;

    /**
     * 评估时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime evaluateTime;

    /**
     * 构造方法
     */
    public SsResExtEvaluateCompareVO() {
        this.standardVO = new SsResExtEvaluateVO(null);
        this.evaluateVO = new SsResExtEvaluateVO(null);
        this.isQualifiedForPost = 0;
    }

    /**
     * 构造方法
     *
     * @param resourceId 数字员工资源ID
     */
    public SsResExtEvaluateCompareVO(Long resourceId) {
        this.standardVO = new SsResExtEvaluateVO(resourceId);
        this.evaluateVO = new SsResExtEvaluateVO(resourceId);
        this.isQualifiedForPost = 0;
        this.evaluateTime = LocalDateTime.now();
    }
}
