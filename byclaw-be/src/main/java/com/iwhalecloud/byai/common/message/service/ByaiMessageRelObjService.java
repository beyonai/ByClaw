package com.iwhalecloud.byai.common.message.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageRelMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchReponseDto;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRel;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.common.message.qo.MessageRelObjQo;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 消息关联对象 Service。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Slf4j
@Service
public class ByaiMessageRelObjService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiMessageRelMapper byaiMessageRelMapper;

    /**
     * 新增消息关联对象
     *
     * @param byaiMessageRelObjDto 消息关联对象
     */
    public void add(ByaiMessageRelObjDto byaiMessageRelObjDto) {
        if (byaiMessageRelObjDto == null) {
            return;
        }
        ByaiMessageRel rel = toRelEntity(byaiMessageRelObjDto);
        rel.setCreateTime(new Date());
        if (rel.getId() == null) {
            rel.setId(sequenceService.nextVal());
        }
        byaiMessageRelMapper.insertOne(rel);
    }

    /**
     * 批量添加关联消息
     *
     * @param byaiMessageRelObjDtos 关联消息
     */
    public void batchAdd(List<ByaiMessageRelObjDto> byaiMessageRelObjDtos) {
        if (byaiMessageRelObjDtos == null || byaiMessageRelObjDtos.isEmpty()) {
            return;
        }
        List<ByaiMessageRel> byaiMessageRels = new ArrayList<>();
        for (ByaiMessageRelObjDto byaiMessageRelObjDto : byaiMessageRelObjDtos) {
            ByaiMessageRel byaiMessageRel = toRelEntity(byaiMessageRelObjDto);
            byaiMessageRel.setCreateTime(new Date());
            if (byaiMessageRel.getId() == null) {
                byaiMessageRel.setId(sequenceService.nextVal());
            }
            byaiMessageRels.add(byaiMessageRel);
        }
        int rows = byaiMessageRelMapper.insertBatch(byaiMessageRels);
        if (rows != byaiMessageRelObjDtos.size()) {
            log.error("batchAdd: 批量插入关联消息失败, expected={}, actual={}", byaiMessageRelObjDtos.size(), rows);
            throw new BaseException(
                String.format("batch insert byai_message_relobj failed, expected=%d, actual=%d",
                    byaiMessageRelObjDtos.size(), rows));
        }
    }

    /**
     * 按关联 ID 删除
     *
     * @param relId 关联 ID
     */
    public void delete(Long relId) {
        if (relId == null) {
            return;
        }
        ByaiMessageRel existing = byaiMessageRelMapper.selectByRelId(relId);
        if (existing == null) {
            log.warn("delete: 关联记录不存在, relId={}", relId);
            return;
        }
        byaiMessageRelMapper.deleteByRelId(relId);
    }

    /**
     * 选择性更新消息关联对象（存在则更新，不存在则插入）
     *
     * @param byaiMessageRelObjDto 消息关联对象
     */
    public void updateSelective(ByaiMessageRelObjDto byaiMessageRelObjDto) {
        if (byaiMessageRelObjDto == null || byaiMessageRelObjDto.getRelId() == null) {
            return;
        }
        ByaiMessageRel existing = byaiMessageRelMapper.selectByRelId(byaiMessageRelObjDto.getRelId());
        ByaiMessageRel update = toRelEntity(byaiMessageRelObjDto);
        if (existing == null) {
            log.info("updateSelective: 关联记录不存在, 执行插入, relId={}", byaiMessageRelObjDto.getRelId());
            byaiMessageRelMapper.insertOne(update);
        } else {
            byaiMessageRelMapper.updateByRelId(update);
        }
    }

    /**
     * 更新消息反馈字段，允许将字段更新为空，用于点赞/点踩/已解决/未解决场景。
     *
     * @param byaiMessageRelObjDto 消息关联对象
     */
    public void updateFeedback(ByaiMessageRelObjDto byaiMessageRelObjDto) {
        if (byaiMessageRelObjDto == null || byaiMessageRelObjDto.getRelId() == null) {
            if (byaiMessageRelObjDto == null || byaiMessageRelObjDto.getAskMsgId() == null
                || byaiMessageRelObjDto.getResMsgId() == null) {
                return;
            }
            int rows = byaiMessageRelMapper.updateFeedbackByMessagePair(toRelEntity(byaiMessageRelObjDto));
            if (rows == 0) {
                log.warn("updateFeedback: 关联记录不存在, askMsgId={}, resMsgId={}",
                    byaiMessageRelObjDto.getAskMsgId(), byaiMessageRelObjDto.getResMsgId());
            }
            return;
        }
        ByaiMessageRel update = toRelEntity(byaiMessageRelObjDto);
        int rows = byaiMessageRelMapper.updateFeedbackByRelId(update);
        if (rows == 0 && byaiMessageRelObjDto.getAskMsgId() != null && byaiMessageRelObjDto.getResMsgId() != null) {
            rows = byaiMessageRelMapper.updateFeedbackByMessagePair(update);
        }
        if (rows == 0) {
            log.warn("updateFeedback: 关联记录不存在, relId={}, askMsgId={}, resMsgId={}",
                byaiMessageRelObjDto.getRelId(), byaiMessageRelObjDto.getAskMsgId(), byaiMessageRelObjDto.getResMsgId());
        }
    }

    /**
     * 根据 JSON 配置查询指标
     *
     * @param configJson 指标配置 JSON
     * @return 指标结果 Map
     */
    public Map<String, Object> queryMetricsByConfig(String configJson) {
        // TODO 待实现
        return new HashMap<>();
    }

    /**
     * 查询关联消息列表
     *
     * @param messageRelObjQo 查询对象
     * @return List<ByaiMessageRelObj>
     */
    public List<ByaiMessageRelObjDto> findByQo(MessageRelObjQo messageRelObjQo) {
        if (messageRelObjQo == null) {
            return Collections.emptyList();
        }
        List<ByaiMessageRel> relList = byaiMessageRelMapper.selectByQo(messageRelObjQo);
        if (relList == null || relList.isEmpty()) {
            return Collections.emptyList();
        }
        List<ByaiMessageRelObjDto> result = new ArrayList<>(relList.size());
        for (ByaiMessageRel rel : relList) {
            result.add(toRelObjDto(rel));
        }
        return result;
    }

    /**
     * 消息关联检索
     *
     * @param request 检索请求
     * @return 分页结果
     */
    public PageResult<MemRelSearchReponseDto> searchMem(MemRelSearchRequestDto request) {
        if (request == null) {
            return PageResult.of(0L, 1, 20, new ArrayList<>());
        }
        Page<ByaiMessageRel> page = PageHelper.startPage(request.getPageNum(), request.getPageSize());
        List<ByaiMessageRel> rows = byaiMessageRelMapper.selectSearchMemPage(request);
        List<MemRelSearchReponseDto> dtoList = rows.stream().map(this::convertToMemRelSearchResponseDTO)
            .collect(Collectors.toList());
        return PageResult.of(page.getTotal(), request.getPageNum(), request.getPageSize(), dtoList);
    }

    private MemRelSearchReponseDto convertToMemRelSearchResponseDTO(ByaiMessageRel byaiMessageRel) {
        MemRelSearchReponseDto dto = new MemRelSearchReponseDto();

        BeanUtils.copyProperties(byaiMessageRel, dto);
        dto.setAskTime(toLocalDateTime(byaiMessageRel.getAskTime()));
        dto.setResTime(toLocalDateTime(byaiMessageRel.getResTime()));
        dto.setFeedbackTime(toLocalDateTime(byaiMessageRel.getFeedbackTime()));
        dto.setCreateTime(toLocalDateTime(byaiMessageRel.getCreateTime()));
        // 这三个字段数据库侧一般是字符串/数组，统一转换成 List<String> 返回前端
        dto.setAskContentTags(parseStringList(byaiMessageRel.getAskContentTags()));
        dto.setResContentTags(parseStringList(byaiMessageRel.getResContentTags()));
        dto.setFeedbackLabel(parseStringList(byaiMessageRel.getFeedbackLabel()));

        // 响应特有字段
        dto.setSuccess(true);
        dto.setMessage("查询成功");
        dto.setResponseTime(LocalDateTime.now());

        return dto;
    }

    private LocalDateTime toLocalDateTime(Date value) {
        return value == null ? null : value.toInstant().atZone(ZoneId.systemDefault()).toLocalDateTime();
    }

    private List<String> parseStringList(Object obj) {
        if (obj == null) {
            return Collections.emptyList();
        }
        if (obj instanceof List<?>) {
            return ((List<?>) obj).stream().filter(Objects::nonNull).map(String::valueOf)
                .filter(StringUtils::isNotBlank).collect(Collectors.toList());
        }
        String value = String.valueOf(obj).trim();
        if (StringUtils.isBlank(value)) {
            return Collections.emptyList();
        }
        if (value.startsWith("[") && value.endsWith("]")) {
            try {
                return JSON.parseArray(value, String.class).stream().filter(StringUtils::isNotBlank)
                    .collect(Collectors.toList());
            } catch (Exception e) {
                value = value.substring(1, value.length() - 1);
            }
        }
        return Arrays.stream(value.split(",")).map(String::trim).map(item -> item.replace("\"", "").replace("'", ""))
            .filter(StringUtils::isNotBlank).collect(Collectors.toList());
    }

    private ByaiMessageRel toRelEntity(ByaiMessageRelObjDto dto) {
        ByaiMessageRel rel = new ByaiMessageRel();
        BeanUtils.copyProperties(dto, rel);
        rel.setFeedbackLabel(formatStringList(dto.getFeedbackLabel()));
        rel.setFeedbackTime(parseDate(dto.getFeedbackTime()));
        return rel;
    }

    private ByaiMessageRelObjDto toRelObjDto(ByaiMessageRel rel) {
        ByaiMessageRelObjDto obj = new ByaiMessageRelObjDto();
        BeanUtils.copyProperties(rel, obj);
        obj.setFeedbackLabel(parseStringList(rel.getFeedbackLabel()));
        // 兼容旧对象结构：ByaiMessageRelObj 中部分时间字段是 String
        if (rel.getResTime() != null) {
            obj.setResTime(new Date());
        }
        if (rel.getFeedbackTime() != null) {
            obj.setFeedbackTime(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").format(
                rel.getFeedbackTime().toInstant().atZone(ZoneId.systemDefault()).toLocalDateTime()));
        }
        return obj;
    }

    private String formatStringList(List<String> valueList) {
        if (valueList == null) {
            return null;
        }
        List<String> values = valueList.stream().filter(StringUtils::isNotBlank).collect(Collectors.toList());
        return values.isEmpty() ? null : JSON.toJSONString(values);
    }

    private Date parseDate(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse(value);
        } catch (ParseException e) {
            log.warn("parseDate: 反馈时间格式非法, value={}", value);
            return null;
        }
    }

}
