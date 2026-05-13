package com.iwhalecloud.byai.manager.mapper.customer;

import java.util.List;

import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;

public interface ByaiCustomerLeadsMapper extends BaseMapper<ByaiCustomerLeads> {
    int insertLead(ByaiCustomerLeads lead);

    int insertBatch(@Param("list") List<ByaiCustomerLeads> list);
}