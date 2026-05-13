package com.iwhalecloud.byai.manager.vo.men;

import com.iwhalecloud.byai.manager.entity.men.MenTask;
import lombok.Getter;
import lombok.Setter;

/**
 * 待办任务接收对象表
 */
@Getter
@Setter
public class MenTaskVo extends MenTask {

    /** 对应前端的contentType枚举；2011：bot动态解释卡片2010:ui-agent卡片2001:图表卡片 */
    private Integer resType;

    /** 构建内容 */
    private String resPage;

    /** 实际处理待办的人 */
    private String dealObjName;

    /** 任务状态描述 */
    private String statusCdName;

    /* 接收类型 */
    private String reciType;

    /* 接收人或者数字员工等 */
    private Long reciObjId;

    /** 创建人 */
    private String createByName;

    /** 待办接收人 */
    private String reciObjName;

    /** 待办接收人 */
    private String createType;

    /** 待办接收人 */
    private Long resourceSourcePkId;

    /** 待办接收人 */
    private String resourceName;

    /** 待办接收人 */
    private String resourceType;

}