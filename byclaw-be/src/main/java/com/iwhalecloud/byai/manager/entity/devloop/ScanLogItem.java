package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_scan_log_item")
public class ScanLogItem {

    @TableId(value = "item_id", type = IdType.INPUT)
    private Long itemId;

    private Long logId;

    private Long sourceId;

    private String title;

    private String content;

    private String originId;

    private String originUrl;

    private String action;

    private Long taskId;

    private Date createTime;
}
