package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.aimodel.AiPrompt;
import com.iwhalecloud.byai.manager.mapper.aimodel.AiPromptMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

/**
 * 智能体提示词模板表Service
 *
 * @author system
 * @date 2025-11-01
 */
@Service
public class AiPromptService {

    @Autowired
    private AiPromptMapper aiPromptMapper;

    /**
     * 根据提示词分组查询提示词列表
     *
     * @param promptGroupCode 提示词分组编码
     * @return 提示词列表
     */
    public List<AiPrompt> findPromptGroupCode(String promptGroupCode) {
        LambdaQueryWrapper<AiPrompt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(AiPrompt::getPromptGroupCode, promptGroupCode);
        return aiPromptMapper.selectList(queryWrapper);
    }

    /**
     * 按 prompt_code 取中文提示词模板；无记录返回 null，交由调用方走内置兜底。
     * 研发闭环提示词从 byai_system_config 迁至本表后的唯一读取入口。
     */
    public String findZhTemplateByCode(String promptCode) {
        LambdaQueryWrapper<AiPrompt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(AiPrompt::getPromptCode, promptCode).last("limit 1");
        AiPrompt prompt = aiPromptMapper.selectOne(queryWrapper);
        return prompt == null ? null : prompt.getPromptZhTemplate();
    }

}
