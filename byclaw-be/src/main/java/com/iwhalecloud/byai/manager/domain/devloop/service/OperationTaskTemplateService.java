package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.OperationTaskTemplate;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationTaskTemplateMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/** 运营任务模板目录查询服务；模板暂由系统迁移脚本初始化，前端只消费启用模板。 */
@Service
public class OperationTaskTemplateService {

    private static final String NORMAL_DELETE_FLAG = "0";
    private static final String ENABLED_STATUS = "00A";

    @Autowired
    private OperationTaskTemplateMapper operationTaskTemplateMapper;

    public List<OperationTaskTemplate> list(String templateType) {
        LambdaQueryWrapper<OperationTaskTemplate> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OperationTaskTemplate::getDeleteFlag, NORMAL_DELETE_FLAG)
            .eq(OperationTaskTemplate::getStatusCd, ENABLED_STATUS)
            .orderByAsc(OperationTaskTemplate::getSortNo)
            .orderByAsc(OperationTaskTemplate::getTemplateId);
        if (templateType != null && !templateType.trim().isEmpty()) {
            wrapper.eq(OperationTaskTemplate::getTemplateType, templateType.trim());
        }
        return operationTaskTemplateMapper.selectList(wrapper);
    }

    public OperationTaskTemplate get(Long templateId) {
        if (templateId == null) {
            return null;
        }
        OperationTaskTemplate template = operationTaskTemplateMapper.selectById(templateId);
        if (template == null || !NORMAL_DELETE_FLAG.equals(template.getDeleteFlag())
            || !ENABLED_STATUS.equals(template.getStatusCd())) {
            return null;
        }
        return template;
    }
}
