package com.iwhalecloud.byai.manager.entity.datasource;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;

/** Independent, reusable connection configuration; never serialize persistence entities to clients. */
@Getter
@Setter
@TableName(value = "byai_datasource")
public class Datasource {
    @TableId(type = IdType.INPUT)
    private Long datasourceId;
    private String datasourceName;
    private String description;
    private String datasourceType;
    private String connectionConfig;
    @JsonIgnore
    private String passwordCipher;
    private Long createBy;
    private Date createTime;
    private Long updateBy;
    private Date updateTime;
}
