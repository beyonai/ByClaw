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
 * 数字员工测试集上传临时表
 */
@Getter
@Setter
@Builder
@TableName("ss_res_ext_test_set")
@AllArgsConstructor
@NoArgsConstructor
public class SsResExtTestSet {

    /**
     * 测试集记录ID（自增主键）：唯一标识每条测试集上传记录，便于数据查询、修改与批量同步
     */
    @TableId(value = "test_set_id", type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long testSetId;

    /**
     * 数字员工资源ID：关联数字员工的核心标识，用于关联查询对应测试集数据
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 测试集批次ID：格式示例batch_20021312312313_313131312，用于区分不同批次上传的测试集
     */
    private String batchId;

    /**
     * 测试集结果Excel文件的URL地址
     */
    private String fileUrl;

    /**
     * 测试集FileId
     */
    private String fileId;

    /**
     * 测试集文件名
     */
    private String fileName;

    /**
     * 测试集处理状态（0=处理成功，1=处理中，2=处理失败）
     */
    private Integer processStatus;

    /**
     * 处理失败原因（仅当process_status=2时回填）
     */
    private String failReason;

    /**
     * 测试集回答准确率
     */
    private BigDecimal testSetAccuracy;

    /**
     * 测试集意图识别准确率
     */
    private BigDecimal testSetIntentRecognitionAccuracy;

    /**
     * 创建人：记录该条测试集数据的上传操作人
     */
    private String createBy;

    /**
     * 数据创建时间：默认当前时间戳，记录测试集数据上传入库的时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime createTime;

    /**
     * 数据更新时间：记录该条测试集数据最后一次修改的时间戳
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime updateTime;
}