package com.iwhalecloud.byai.manager.entity.contract;

import lombok.Getter;
import lombok.Setter;

/**
 * 发票数据传输对象 包含发票日期和金额信息
 * 
 * @author he.duming
 * @date 2025-01-27
 */
@Getter
@Setter
public class InvoiceDto {

    /** 发票金额 */
    private String invoiceAmount;

    /** 发票日期 */
    private String invoiceDate;

    /** 发票号 */
    private String invoiceNo;

    /** 不含税发票金额 */
    private String invoiceExcludedAmount;
}
