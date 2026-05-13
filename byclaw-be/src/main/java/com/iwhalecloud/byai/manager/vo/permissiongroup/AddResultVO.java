package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 新增操作结果视图对象
 * 用于封装新增操作返回的ID，防止前端Long类型精度丢失
 */
@Getter
@Setter
public class AddResultVO {

    /**
     * 新增记录的ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 默认构造函数
     */
    public AddResultVO() {
    }

    /**
     * 带ID的构造函数
     *
     * @param id 新增记录的ID
     */
    public AddResultVO(Long id) {
        this.id = id;
    }

    /**
     * 静态工厂方法
     *
     * @param id 新增记录的ID
     * @return AddResultVO实例
     */
    public static AddResultVO of(Long id) {
        return new AddResultVO(id);
    }

}

