package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_scan_log")
public class ScanLog {

    @TableId(value = "log_id", type = IdType.INPUT)
    private Long logId;

    private Long sourceId;

    private Long projectId;

    private Date scanTime;

    private Integer foundCount;

    private Integer createdCount;

    private String status;

    private String errorMsg;
}
