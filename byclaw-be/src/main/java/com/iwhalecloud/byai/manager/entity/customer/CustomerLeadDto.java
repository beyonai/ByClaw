package com.iwhalecloud.byai.manager.entity.customer;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class CustomerLeadDto {
    List<ByaiCustomerLeads> list;
}

