package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_scan_require_item")
public class ScanRequireItem {

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

    /** AI综合评分 0-100 */
    private Integer score;

    /** AI优先级 P0/P1/P2 */
    private String priority;

    /** AI评分明细JSON：各维度得分/风险/AI整理需求 */
    private String scoreDetail;

    /** 拆分溯源：子需求指向被拆分的原始 item；未拆分为空 */
    private Long parentItemId;

    /** 归一化内容指纹，二期去重用 */
    private String contentHash;

    /** 去重状态 normal/suspected_dup/confirmed_dup/not_dup */
    private String dedupStatus;

    /** 疑似/确认重复时指向的原始 item */
    private Long duplicateOfItemId;

    private Date createTime;
}
