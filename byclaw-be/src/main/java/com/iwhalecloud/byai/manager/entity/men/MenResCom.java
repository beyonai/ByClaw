package com.iwhalecloud.byai.manager.entity.men;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 资源组件表
 */
@Getter
@Setter
@TableName("men_res_com")
public class MenResCom {

    /** 主键标识 */
    @TableId(value = "res_com_id", type = IdType.INPUT)
    private Long resComId;

    /** 对应前端的contentType枚举类型；2011：bot动态解释卡片2010:ui-agent卡片2001:图表卡片 */
    private Integer resType;

    /** 构建内容json */
    private String resPage;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    private Date createTime;

    /** 更新人 */
    private Long updateBy;

    /** 更新时间 */
    private Date updateTime;

    /** 所属企业 */
    private Long comAcctId;
}