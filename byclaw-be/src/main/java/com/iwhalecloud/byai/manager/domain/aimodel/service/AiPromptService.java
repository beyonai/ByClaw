package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.util.ListUtil;
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
     * 根据提示词分组查询提示词列表,只查询第一条
     *
     * @param promptGroupCode 提示词分组编码
     * @return 提示词列表
     */
    public AiPrompt findFirst(String promptGroupCode) {
        List<AiPrompt> promptGroupCodes = this.findPromptGroupCode(promptGroupCode);
        return ListUtil.isNotEmpty(promptGroupCodes) ? promptGroupCodes.getFirst() : null;
    }


    /**
     * 按 prompt_code 取提示词模板：language 传 "en" 取英文模板，其余(含 null/空)默认中文。
     * 英文模板缺失时回退中文，保证有内容可用。无记录返回 null，交由调用方走内置兜底。
     * 研发闭环和运营闭环提示词从 byai_system_config 迁至本表后的统一读取入口，language 约定同项目其它处("zh"/"en")。
     */
    public String findTemplateByCode(String promptCode, String language) {
        LambdaQueryWrapper<AiPrompt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(AiPrompt::getPromptCode, promptCode).last("limit 1");
        AiPrompt prompt = aiPromptMapper.selectOne(queryWrapper);
        if (prompt == null) {
            return null;
        }
        boolean useEn = language != null && language.toLowerCase().startsWith("en");
        if (useEn) {
            String en = prompt.getPromptEnTemplate();
            return en != null && !en.isEmpty() ? en : prompt.getPromptZhTemplate();
        }
        return prompt.getPromptZhTemplate();
    }

}
