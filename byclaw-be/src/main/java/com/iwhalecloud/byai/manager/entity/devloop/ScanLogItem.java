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

    /** 已启动会话ID：需求启动后回写，标记“已启动”并支持跳转会话 */
    private Long sessionId;

    private Date createTime;
}
