package com.iwhalecloud.byai.common.feign.request.knowledge;

import java.util.List;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-09-25 17:29:44
 * @description TODO
 */

@Getter
@Setter
public class ChunkMetadataFilter {

    private List<String> contractNum;

    private String contractName;

    private Float textContractMoneyMin;

    private Float textContractMoneyMax;

    private String signDateStart;

    private String signDateEnd;

    private String operatorName;

    private String companyName;

    private String operaName;

    private String isEffectiveInvoice;

    private Float invoiceAmountTotalMin;

    private Float invoiceAmountTotalMax;

    private String belongTo;

    /**
     * 设置合同编号列表，自动去掉每个元素的两边空格并去�?
     */
    public void setContractNum(List<String> contractNum) {
        if (contractNum == null || contractNum.isEmpty()) {
            this.contractNum = null;
            return;
        }

        this.contractNum = contractNum.stream().filter(StringUtils::isNotBlank) // 过滤掉空字符�?
            .map(String::trim) // 去掉每个元素的两边空�?
            .distinct() // 去重
            .collect(Collectors.toList());
    }

    /**
     * 设置合同名称，自动去掉两边空�?
     */
    public void setContractName(String contractName) {
        this.contractName = StringUtils.isNotBlank(contractName) ? contractName.trim() : null;
    }

    /**
     * 设置签单开始日期，自动去掉两边空格
     */
    public void setSignDateStart(String signDateStart) {
        this.signDateStart = StringUtils.isNotBlank(signDateStart) ? signDateStart.trim() : null;
    }

    /**
     * 设置签单结束日期，自动去掉两边空�?
     */
    public void setSignDateEnd(String signDateEnd) {
        this.signDateEnd = StringUtils.isNotBlank(signDateEnd) ? signDateEnd.trim() : null;
    }

    /**
     * 设置客户名称，自动去掉两边空�?
     */
    public void setOperatorName(String operatorName) {
        this.operatorName = StringUtils.isNotBlank(operatorName) ? operatorName.trim() : null;
    }

    /**
     * 设置合同归属公司，自动去掉两边空�?
     */
    public void setCompanyName(String companyName) {
        this.companyName = StringUtils.isNotBlank(companyName) ? companyName.trim() : null;
    }

    /**
     * 设置运营商，自动去掉两边空格
     */
    public void setOperaName(String operaName) {
        this.operaName = StringUtils.isNotBlank(operaName) ? operaName.trim() : null;
    }

    /**
     * 设置是否存在有效发票，自动去掉两边空�?
     */
    public void setIsEffectiveInvoice(String isEffectiveInvoice) {
        this.isEffectiveInvoice = StringUtils.isNotBlank(isEffectiveInvoice) ? isEffectiveInvoice.trim() : null;
    }
}
