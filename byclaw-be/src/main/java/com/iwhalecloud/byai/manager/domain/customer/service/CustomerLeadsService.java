package com.iwhalecloud.byai.manager.domain.customer.service;

import java.util.Date;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.manager.mapper.customer.ByaiCustomerLeadsMapper;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.entity.customer.CustomerLeadDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

@Service
public class CustomerLeadsService {

    @Autowired
    private ByaiCustomerLeadsMapper leadsMapper;

    @Autowired
    private SequenceService SequenceService;

    public Long addLead(ByaiCustomerLeads lead) {
        lead.setId(SequenceService.nextVal());
        lead.setCreateTime(new Date());
        lead.setPhone(CurrentUserHolder.getPhone());
        leadsMapper.insertLead(lead);
        return lead.getId();
    }

    public int batchAdd(CustomerLeadDto list) {
        List<ByaiCustomerLeads> lists = list.getList();

        if (lists == null || lists.isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("customer.leads.batch.empty"));
        }

        for (ByaiCustomerLeads item : lists) {
            item.setId(SequenceService.nextVal());
            item.setCreateTime(new Date());
            item.setPhone(CurrentUserHolder.getPhone());
        }
        return leadsMapper.insertBatch(lists);
    }
}