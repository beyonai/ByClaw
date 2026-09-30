package com.iwhalecloud.byai.manager.application.service.conversation;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.ConversationSearchConstants;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchReponseDto;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.qo.conversation.ConversationSearchQo;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class ConversationSearchSkillService {

    private final ByaiSystemConfigMapper systemConfigMapper;
    private final UsersMapper usersMapper;
    private final ByaiMessageRelObjService messageService;
    private final ObjectMapper objectMapper;

    public PageResult<MemRelSearchReponseDto> search(ConversationSearchQo query) {
        requireAllowedCaller();
        validate(query);

        MemRelSearchRequestDto request = new MemRelSearchRequestDto();
        request.setPageNum(query.getPageNum());
        request.setPageSize(query.getPageSize());
        request.setSortField("askTime");
        request.setSortDirection("DESC");
        if (query.getUserCode() != null) {
            // Include inactive users: their historical conversations remain searchable.
            List<Users> users = usersMapper.selectList(new LambdaQueryWrapper<Users>()
                .eq(Users::getUserCode, query.getUserCode().trim()));
            if (users.isEmpty()) {
                return PageResult.of(0L, query.getPageNum(), query.getPageSize(), List.of());
            }
            request.setAskObjTypes(List.of(ChatObjType.HUMAN));
            request.setAskObjIds(users.stream().map(Users::getUserId).toList());
        }
        if (query.getDigitalEmployeeId() != null) {
            request.setResObjTypes(List.of(ChatObjType.AGENT));
            request.setResObjIds(List.of(query.getDigitalEmployeeId()));
        }
        if (query.getStartTime() != null || query.getEndTime() != null) {
            request.setAskTimeRange(Arrays.asList(query.getStartTime(), query.getEndTime()));
        }
        if (query.getKeyword() != null) {
            // PostgreSQL LIKE escaping: user text is a literal substring, never a wildcard expression.
            request.setKeyword(query.getKeyword().trim().replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_"));
        }
        return messageService.searchMem(request);
    }

    private void requireAllowedCaller() {
        String caller = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(caller) || CurrentUserHolder.getLoginInfo() == null
            || CurrentUserHolder.getLoginInfo().getUserId() == null) {
            throw denied();
        }
        // Read the authoritative table on every request/page. Revocation must not wait for Redis expiry.
        // Duplicate keys are ambiguous and fail closed, as do database read failures.
        List<ByaiSystemConfig> configs = systemConfigMapper.selectList(new LambdaQueryWrapper<ByaiSystemConfig>()
            .eq(ByaiSystemConfig::getParamCode, ConversationSearchConstants.ALLOWED_USER_CODES).last("LIMIT 2"));
        if (configs.size() != 1 || StringUtils.isBlank(configs.getFirst().getParamValue())) {
            throw denied();
        }
        JsonNode allowed;
        try {
            allowed = objectMapper.readerFor(JsonNode.class)
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(configs.getFirst().getParamValue());
        } catch (JsonProcessingException e) {
            throw denied();
        }
        if (allowed == null || !allowed.isArray() || allowed.isEmpty()) {
            throw denied();
        }
        boolean matched = false;
        for (JsonNode entry : allowed) {
            if (!entry.isTextual() || StringUtils.isBlank(entry.textValue()) || "*".equals(entry.textValue().trim())) {
                throw denied();
            }
            matched |= caller.equals(entry.textValue().trim());
        }
        // Deliberately no role, employee-owner or employee/resource-grant bypass.
        if (!matched) {
            throw denied();
        }
    }

    private ResponseStatusException denied() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "当前用户无权使用对话记录搜索技能");
    }

    private void validate(ConversationSearchQo query) {
        if (query == null || query.getPageNum() == null || query.getPageNum() < 1
            || query.getPageSize() == null || query.getPageSize() < 1 || query.getPageSize() > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "pageNum必须大于0，pageSize必须在1到100之间");
        }
        if ((query.getUserCode() != null && (StringUtils.isBlank(query.getUserCode()) || query.getUserCode().length() > 128))
            || (query.getDigitalEmployeeId() != null && query.getDigitalEmployeeId() <= 0)
            || (query.getKeyword() != null && (StringUtils.isBlank(query.getKeyword()) || query.getKeyword().length() > 1000))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户编码、数字员工ID或关键字无效");
        }
        if (query.getStartTime() != null && query.getEndTime() != null
            && query.getStartTime().isAfter(query.getEndTime())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "开始时间不能晚于结束时间");
        }
    }
}
