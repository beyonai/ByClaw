package com.iwhalecloud.byai.manager.interfaces.controller.customer;

import com.iwhalecloud.byai.manager.entity.customer.CustomerLeadDto;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.domain.customer.service.CustomerLeadsService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/customer/leads")
public class CustomerLeadsController {

    @Autowired
    private CustomerLeadsService customerLeadsService;

    @PostMapping("/add")
    public ResponseUtil add(@RequestBody ByaiCustomerLeads lead) {
        Long id = customerLeadsService.addLead(lead);
        return ResponseUtil.successResponse(id);
    }

    @PostMapping("/batchAdd")
    public ResponseUtil batchAdd(@RequestBody CustomerLeadDto leads) {
        int count = customerLeadsService.batchAdd(leads);
        return ResponseUtil.successResponse(count);
    }
}