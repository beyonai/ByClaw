#!/bin/sh
# env-decrypt.sh — 解密 .env 中的 ENC(...) 密文字段 (POSIX sh 兼容)
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

_ENV_DECRYPT_INPUT="${1:-${_ENV_DECRYPT_SRC:-}}"
_ENV_DECRYPT_OUTPUT="${2:-${_ENV_DECRYPT_DST:-}}"

if [ -z "$_ENV_DECRYPT_INPUT" ] || [ -z "$_ENV_DECRYPT_OUTPUT" ]; then
    echo "Usage: . env-decrypt.sh <input.env> <output.env>" >&2
    return 1 2>/dev/null || exit 1
fi

if [ ! -f "$_ENV_DECRYPT_INPUT" ]; then
    return 0 2>/dev/null || exit 0
fi

if ! grep -q 'ENC(' "$_ENV_DECRYPT_INPUT" 2>/dev/null; then
    _ENV_DECRYPT_NEEDED=false
    return 0 2>/dev/null || exit 0
fi

_ENV_DECRYPT_NEEDED=true

_BUILTIN_KEY_HEX="7734484041394b6c6d214530364f5e38"

_get_sm4_key() {
    if [ -n "${BYCLAW_SM4_KEY:-}" ]; then
        echo "$BYCLAW_SM4_KEY"
        return 0
    fi
    _kf="${BYCLAW_SM4_KEY_FILE:-}"
    if [ -z "$_kf" ]; then
        if [ -f /etc/byclaw/sm4.key ]; then
            _kf="/etc/byclaw/sm4.key"
        elif [ -f "$HOME/.byclaw/sm4.key" ]; then
            _kf="$HOME/.byclaw/sm4.key"
        fi
    fi
    if [ -n "$_kf" ] && [ -f "$_kf" ]; then
        tr -d '\n' < "$_kf"
        return 0
    fi
    echo "$_BUILTIN_KEY_HEX"
}

_SM4_KEY=$(_get_sm4_key)

_sm4_decrypt() {
    echo "$1" | openssl enc -sm4-ecb -K "$_SM4_KEY" -base64 -d 2>/dev/null
}

> "$_ENV_DECRYPT_OUTPUT"
chmod 600 "$_ENV_DECRYPT_OUTPUT"

_decrypt_failed=false

while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        ""|\#*|" "*)
            echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
            continue
            ;;
    esac

    _eq_key="${line%%=*}"
    _eq_val="${line#*=}"

    if [ "$_eq_key" = "$line" ]; then
        echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
        continue
    fi

    case "$_eq_val" in
        ENC\(*)
            _cipher="${_eq_val#ENC(}"
            _cipher="${_cipher%)}"
            _plain=$(_sm4_decrypt "$_cipher")
            if [ $? -ne 0 ] || [ -z "$_plain" ]; then
                echo "ERROR: SM4 解密失败 — $_eq_key" >&2
                _decrypt_failed=true
                continue
            fi
            echo "${_eq_key}=${_plain}" >> "$_ENV_DECRYPT_OUTPUT"
            ;;
        *)
            echo "$line" >> "$_ENV_DECRYPT_OUTPUT"
            ;;
    esac
done < "$_ENV_DECRYPT_INPUT"

if [ "$_decrypt_failed" = true ]; then
    rm -f "$_ENV_DECRYPT_OUTPUT"
    echo "ERROR: 部分字段解密失败, 请检查 SM4 密钥是否正确" >&2
    return 1 2>/dev/null || exit 1
fi

unset _SM4_KEY _decrypt_failed _eq_key _eq_val _cipher _plain _kf
