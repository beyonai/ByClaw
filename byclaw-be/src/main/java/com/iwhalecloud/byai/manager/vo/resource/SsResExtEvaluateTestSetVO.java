package com.iwhalecloud.byai.manager.vo.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.dto.resource.TestSetResultDTO;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 数字员工测试集结果
 */
@Getter
@Setter
public class SsResExtEvaluateTestSetVO {
    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 测试集回答准确率：百分比格式，存储测试集上的回答准确比例（如85.00代表85%）
     */
    private BigDecimal testSetAccuracy;

    /**
     * 测试集意图识别准确率：百分比格式，存储测试集上的意图识别准确率（如85.00代表85%）
     */
    private BigDecimal testSetIntentRecognitionAccuracy;

    /**
     * 测试集名称
     */
    private String testSetName;

    /**
     * 测试时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime testTime;

    /**
     * 测试结果详情列表
     */
    private List<TestSetResultDTO> testResult;


}
