package com.iwhalecloud.byai.manager.entity.pluginmodule;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@TableName("digital_employee")
public class DigitalEmployee {

    @TableId(value = "id", type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    private String employeeCode;

    private String employeeName;

    private String employeeType;

    private String sourceSystem;

    private Integer status;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
