#!/bin/bash
# env-decrypt.sh — 解密 .env 中的 ENC(...) 密文字段
# 算法: SM4/ECB/PKCS5Padding + Base64, 与 Java Sm4Util 完全兼容
#
# 用法: . env-decrypt.sh <input.env> <output.env>
# 依赖: openssl >= 1.1.1 (支持 sm4-ecb)
#
# 密钥来源 (优先级从高到低):
#   1. 环境变量 BYCLAW_SM4_KEY (32位hex字符串, 即16字节密钥)
#   2. 环境变量 BYCLAW_SM4_KEY_FILE 指定的文件
#   3. /etc/byclaw/sm4.key
#   4. ~/.byclaw/sm4.key
#   5. 内置默认密钥 (与 Java Sm4Util.DEFAULT_KEY_HEX 一致)
#
# 如果 .env 中没有 ENC(...) 字段, 此脚本不做任何事。

_ENV_DECRYPT_INPUT="${1:-}"
_ENV_DECRYPT_OUTPUT="${2:-}"

if [ -z "$_ENV_DECRYPT_INPUT" ] || [ -z "$_ENV_DECRYPT_OUTPUT" ]; then
    echo "Usage: . env-decrypt.sh <input.env> <output.env>" >&2
    return 1 2>/dev/null || exit 1
fi

if [ ! -f "$_ENV_DECRYPT_INPUT" ]; then
    return 0 2>/dev/null || exit 0
fi

# 检测是否包含密文
if ! grep -q 'ENC(' "$_ENV_DECRYPT_INPUT" 2>/dev/null; then
    _ENV_DECRYPT_NEEDED=false
    return 0 2>/dev/null || exit 0
fi

_ENV_DECRYPT_NEEDED=true

# Java Sm4Util 内置的默认密钥
_BUILTIN_KEY_HEX="7734484041394b6c6d214530364f5e38"

# 获取 SM4 密钥
_get_sm4_key() {
    if [ -n "${BYCLAW_SM4_KEY:-}" ]; then
        echo "$BYCLAW_SM4_KEY"
        return 0
    fi

    local key_file="${BYCLAW_SM4_KEY_FILE:-}"
    if [ -z "$key_file" ]; then
        if [ -f /etc/byclaw/sm4.key ]; then
            key_file="/etc/byclaw/sm4.key"
        elif [ -f "$HOME/.byclaw/sm4.key" ]; then
            key_file="$HOME/.byclaw/sm4.key"
        fi
    fi

    if [ -n "$key_file" ] && [ -f "$key_file" ]; then
        cat "$key_file" | tr -d '\n'
        return 0
    fi

    # 使用内置默认密钥
    echo "$_BUILTIN_KEY_HEX"
}

_SM4_KEY=$(_get_sm4_key)

# SM4/ECB 解密
_sm4_decrypt() {
    local cipher="$1"
    echo "$cipher" | openssl enc -sm4-ecb -K "$_SM4_KEY" -base64 -d 2>/dev/null
}

# 执行解密
> "$_ENV_DECRYPT_OUTPUT"
chmod 600 "$_ENV_DECRYPT_OUTPUT"

_decrypt_failed=false

while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
        echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
        continue
    fi

    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        if [[ "$value" =~ ^ENC\((.+)\)$ ]]; then
            cipher="${BASH_REMATCH[1]}"
            plain=$(_sm4_decrypt "$cipher")
            if [ $? -ne 0 ] || [ -z "$plain" ]; then
                echo "ERROR: SM4 解密失败 — $key (请检查密钥是否与加密时一致)" >&2
                _decrypt_failed=true
                continue
            fi
            echo "${key}=${plain}" >> "$_ENV_DECRYPT_OUTPUT"
        else
            echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
        fi
    else
        echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
    fi
done < "$_ENV_DECRYPT_INPUT"

if [ "$_decrypt_failed" = true ]; then
    rm -f "$_ENV_DECRYPT_OUTPUT"
    echo "ERROR: 部分字段解密失败, 请检查 SM4 密钥是否正确" >&2
    return 1 2>/dev/null || exit 1
fi

echo "ENV decrypt: SM4 解密完成 $_ENV_DECRYPT_INPUT → $_ENV_DECRYPT_OUTPUT"

unset _SM4_KEY _decrypt_failed
