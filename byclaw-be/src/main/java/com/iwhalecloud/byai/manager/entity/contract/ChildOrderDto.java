package com.iwhalecloud.byai.manager.entity.contract;

import lombok.Getter;
import lombok.Setter;

/**
 * 子订单数据传输对象 包含子订单号和子订单名称信息
 * 
 * @author he.duming
 * @date 2025-01-27
 */
@Getter
@Setter
public class ChildOrderDto {

    /** 子订单号 */
    private String childOrderNum;

    /** 子订单名称 */
    private String childOrderName;
}
