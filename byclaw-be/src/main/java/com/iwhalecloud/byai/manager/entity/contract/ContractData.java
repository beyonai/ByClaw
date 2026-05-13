package com.iwhalecloud.byai.manager.entity.contract;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 合同数据模型 包含合同基本信息、发票信息和子订单信息
 * 
 * @author he.duming
 * @date 2025-09-24
 */

@Getter
@Setter
public class ContractData {

    /**
     * 主键
     */
    private String id;

    /**
     * 文档评分
     */
    private Double score;

    /**
     * 文档标识
     */
    private Long docId;

    /** 合同编号 */
    private String contractNum;

    /** 合同标识 */
    private String contractId;

    /** 合同名称 */
    private String contractName;

    /** 合同大类 */
    private String contractBigType;

    /** 关联框架号 */
    private String conNum;

    /** 合同状态 */
    private String contractStateName;

    /** 签单时间 */
    private String signDate;

    /** 合同签约原币金额 */
    private String textContractMoney;

    /** 合同归属公司 */
    private String companyName;

    /** 客户 */
    private String operatorName;

    /** 合同归属中心 */
    private String belongTo;

    /** 运营商 */
    private String operaName;

    /** 是否存在有效发票 */
    private String isEffectiveInvoice;

    /** 发票张数 */
    private String invoiceNum;

    /** 发票总额 */
    private String invoiceAmountTotal;

    /** 关键字匹配明细 */
    private String keywordMatching;

    /** 发票信息列表 */
    private List<InvoiceDto> invoiceDtos = new ArrayList<>();

    /** 子订单信息列表 */
    private List<ChildOrderDto> childOrderDtos = new ArrayList<>();

    /** 主合同文件 */
    private List<String> masterContractUrlList;

    /** 合同附件文件 */
    private List<String> contractAttachmentUrlList;

}
