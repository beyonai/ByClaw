package com.iwhalecloud.byai.manager.domain.customer.model;

import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class CustomerLeadDto {
    List<ByaiCustomerLeads> list;
}
