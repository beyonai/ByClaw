package com.iwhalecloud.byai.manager.validate.resource.rule;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidResourceSample;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class ResourceSampleValidator implements ConstraintValidator<ValidResourceSample, String> {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void initialize(ValidResourceSample constraintAnnotation) {
        // 初始化方法
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // 空值处理（如需非空校验，需配合@NotEmpty）
        if (value == null || value.trim().isEmpty()) {
            return true;
        }

        try {
            // 1. 验证是否为合法JSON
            JsonNode node = objectMapper.readTree(value);

            // 2. 验证是否为JSON数组
            if (!node.isArray()) {
                return false;
            }

            ArrayNode arrayNode = (ArrayNode) node;

            // 3. 验证数组元素（拒绝非字符串、null、空字符串、纯空格字符串）
            for (JsonNode element : arrayNode) {
                // 3.1 拒绝非字符串元素（如数字、布尔等）
                if (!element.isTextual()) {
                    return false;
                }

                // 3.2 转换为字符串后校验
                String elementStr = element.asText();

                // 3.3 拒绝null（虽然isTextual()已排除null，但保险起见）
                if (element.isNull()) {
                    return false;
                }

                // 3.4 拒绝空字符串或纯空格字符串
                if (elementStr.trim().isEmpty()) {
                    return false;
                }
            }

            // 所有校验通过
            return true;

        } catch (Exception e) {
            // 解析失败（如无效JSON格式）
            return false;
        }
    }
}