package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.resource.AiModel;
import com.iwhalecloud.byai.manager.mapper.resource.AiModelMapper;
import org.apache.commons.collections4.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * AI模型数据库服务类
 */
@Service
public class AiModelDbService {

    @Autowired
    private AiModelMapper aiModelMapper;

    /**
     * 查询所有AI模型列表
     * 
     * @return AI模型列表
     */
    public List<AiModel> getAiModels() {
        LambdaQueryWrapper<AiModel> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(AiModel::getStatus, "1");
        List<AiModel> list = aiModelMapper.selectList(queryWrapper);
        if (CollectionUtils.isNotEmpty(list)) {
            // 手动�?authToken 置为空字符串,人工渗透测试不暴露authtoken
            list.forEach(model -> model.setAuthToken(""));
        }
        return list;
    }
}