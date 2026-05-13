package com.iwhalecloud.byai.manager.entity.superassist;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 助理资源授权使用明细：仅记录与规格数据不一致的明细数据，当用户在超级助手管理单独授权时才更新该表数据 This class corresponds to the database table
 * suas_superassist_resource_privilege
 */
@Getter
@Setter
@TableName("suas_superassist_resource_privilege")
public class SuasSuperassistResourcePrivilege {
    /**
     * 主键
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 助理标识
     */
    private Long superassistId;

    /**
     * 可使用的数字资源id
     */
    private Long resourceId;

    /**
     * 数字资源类型，取值范围KNOWLEDGE_BASE、DATA_BASE
     */
    private String resourceType;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 授权类型：INNER表示内部授权，OUTER表示外部授权
     */
    private String privilegeType;
}
