package com.iwhalecloud.byai.manager.entity.superassist;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-05-06 22:12:29
 * @description TODO
 */
@Getter
@Setter
@TableName("suas_superassist")
public class SuasSuperassist {

    /**
     * 主键标识
     */
    @TableId(value = "superassist_id", type = IdType.INPUT)
    private Long superassistId;

    /**
     * 助理 logo，默认值为 'default'
     */
    private String avatar;

    /**
     * 助理简介
     */
    private String intro;

    /**
     * 助理名称
     */
    private String name;

    /**
     * 创建时间，默认值为当前系统时间
     */
    private Date createTime;

    /**
     * 创建用户
     */
    private Long createUser;

    /**
     * 助理配置
     */
    private String prologue;

    /**
     * 状态：00：正常，01：注销，默认值为 '00'
     */
    private String status;

    /**
     * 所属企业
     */
    private Long comAcctId;

    /**
     * 助理关联唯一个知识库id，用于存储上传的文档
     */
    private Long sessionDatasetId;

    /**
     * 用户默认个人助理数字员工ID
     */
    private Long defaultDigEmployeeId;

}
