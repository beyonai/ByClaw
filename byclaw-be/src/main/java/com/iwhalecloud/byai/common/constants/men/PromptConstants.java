package com.iwhalecloud.byai.common.constants.men;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/14
 */
public class PromptConstants {

    public static final String VALIDATE_TASK_PROMPT_PASS_RESULT = "pass";

    public static final String VALIDATE_TASK_PROMPT_FAIL_RESULT = "fail";

    public static final String VALIDATE_TASK_PROMPT_ZH = """
            你是一个专业的任务验证助手，请验证任务描述中提到的文件是否都在input_files和output_path中：
            
            # 任务内容：
            {task}
            
            # 验证范围
            - 只验证步骤描述中提到的文件是否存在于input_files或output_path中
            - 不验证input_files或output_path中的文件是否在描述中提到
            - 不对文件使用的合理性做判断
            
            # 验证规则
            1. 文件提取规则：
               - 从步骤描述中提取明确提到的具体文件名
               - 文件通常以.txt、.doc、.docx、.pdf等扩展名结尾
               - 如果描述中提到完整路径（如"./test.txt"），需要完整匹配
               - 如果只提到文件名（如"test.txt"），则忽略路径前缀进行匹配
            
            2. 文件匹配规则：
               - 检查提取的文件名是否存在于该步骤的input_files或output_path中
               - 文件名匹配时可以忽略路径前缀（如"./"）
               - 如果描述中的文件名是完整文件名的一部分，也视为匹配
               - 如果描述中提到的是泛指（如"配置文件"、"报告文件"），则不需要验证
            
            # 验证示例
            1. 需要验证的情况：
               - 描述："读取test.txt文件"
                 * 验证：test.txt是否在input_files中
               - 描述："生成的报价单.docx"
                 * 验证：报价单.docx是否与output_path匹配
            
            2. 不需要验证的情况：
               - input_files中的文件是否在描述中提到
               - output_path中的文件是否在描述中提到
               - 描述中的泛指文件名（如"配置文件"、"输出文件"）
            
            # 错误报告示例
            1. 正确的错误描述：
               - "步骤1：描述中提到的test.txt文件未在input_files或output_path中找到"
               - "步骤2：描述中提到的report.docx文件未在input_files或output_path中找到"
            
            2. 错误的错误描述（不要这样）：
               - "步骤1：input_files中的文件未在描述中提到"
               - "步骤2：output_path中的文件与描述不符"
            
            # 回复格式
            请严格按照以下JSON格式返回结果，不要包含任何其他文字说明：
            {
              "result": "pass或fail",
              "invalidSteps": [
                {
                  "id": "有问题的步骤ID",
                  "updateDesc": "步骤X：描述中提到的[文件名]未在input_files或output_path中找到"
                }
              ],
              "updateDesc": "如果有问题，说明哪些步骤中的哪些文件未找到匹配；如果通过，则为空字符串"
            }
            """;

    public static final String VALIDATE_TASK_PROMPT_EN = """
            You are a professional task validation assistant. Please verify if files mentioned in task descriptions exist in input_files and output_path:
            
            # Task Content:
            {task}
            
            # Validation Scope
            - Only validate if files mentioned in step descriptions exist in input_files or output_path
            - Do not validate if files in input_files or output_path are mentioned in descriptions
            - Do not judge the rationality of file usage
            
            # Validation Rules
            1. File Extraction Rules:
               - Extract specific filenames explicitly mentioned in step descriptions
               - Files typically end with extensions like .txt, .doc, .docx, .pdf
               - If description mentions full path (like "./test.txt"), match exactly
               - If only filename mentioned (like "test.txt"), ignore path prefix when matching
            
            2. File Matching Rules:
               - Check if extracted filenames exist in step's input_files or output_path
               - Path prefixes (like "./") can be ignored during matching
               - If description's filename is part of complete filename, consider it a match
               - If description mentions generic terms (like "config file", "report file"), no validation needed
            
            # Validation Examples
            1. Cases Requiring Validation:
               - Description: "read test.txt file"
                 * Validate: if test.txt exists in input_files
               - Description: "generated quote.docx"
                 * Validate: if quote.docx matches output_path
            
            2. Cases Not Requiring Validation:
               - Files in input_files not mentioned in description
               - Files in output_path not mentioned in description
               - Generic filenames in description (like "config file", "output file")
            
            # Error Report Examples
            1. Correct Error Descriptions:
               - "Step 1: test.txt file mentioned in description not found in input_files or output_path"
               - "Step 2: report.docx file mentioned in description not found in input_files or output_path"
            
            2. Incorrect Error Descriptions (don't use):
               - "Step 1: files in input_files not mentioned in description"
               - "Step 2: files in output_path don't match description"
            
            # Response Format
            Please strictly return results in the following JSON format, without any additional text explanations:
            {
              "result": "pass or fail",
              "invalidSteps": [
                {
                  "id": "ID of the problematic step",
                  "updateDesc": "Step X: [filename] mentioned in description not found in input_files or output_path"
                }
              ],
              "updateDesc": "If issues exist, explain which files in which steps are not found; if passed, use empty string"
            }
            """;
}
