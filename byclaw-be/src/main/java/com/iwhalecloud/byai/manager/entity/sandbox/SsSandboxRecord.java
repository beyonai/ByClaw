package com.iwhalecloud.byai.manager.entity.sandbox;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 沙箱记录实体类 记录用户沙箱环境的创建、状态和访问信息
 */

@Setter
@Getter
@TableName("ss_sandbox_record")
public class SsSandboxRecord {

    /** 主键ID */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /** 资源ID */
    private Long resourceId;

    /** 用户编码 */
    private String userCode;

    /** 沙箱类型 */
    private String sandboxType;

    /** 沙箱访问端点地址 */
    private String endpoint;

    /** 会话ID */
    private String chatId;

    /** 沙箱状态：RUNNING-运行中，RELEASED-已释放 */
    private String status;

    /** 是否自动释放 1:自动释放 0:特权用户（长期沙箱） */
    private Integer autoRelease;

    /** 最近一次访问时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date lastAccessTime;

    /** 创建时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
