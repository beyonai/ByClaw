"""Independent model probes using decrypted model configuration read from OpenGauss."""
import base64
import os
import json
import math
import re
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def safe_message(value, secrets=()):
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(str(secret), '[REDACTED]')
    text = re.sub(r'(?i)bearer\s+\S+', 'Bearer [REDACTED]', text)
    text = re.sub(r'[A-Za-z0-9_+/=-]{24,}', '[REDACTED]', text)
    return ' '.join(text.split())[:400]


def upstream_error(error, secrets):
    try:
        data = json.loads(error.read(16384))
        item = data.get('error', data)
        if isinstance(item, dict):
            return safe_message(' / '.join(str(item[k]) for k in ('code', 'type', 'message') if item.get(k)), secrets)
        return safe_message(item, secrets)
    except Exception:
        return '上游未返回可解析的 JSON 错误信息。'


def probe(kind, model, opener=None):
    if not model or any(not str(model.get(k) or '').strip() for k in ('url', 'authToken', 'modelCode')):
        return '待配置', '缺少启用模型、接口地址、Token 或模型编码。'
    params = model.get('instanceParam') or {}
    url = model['url'].rstrip('/')
    suffix = '/chat/completions' if kind == 'LLM' else '/embeddings'
    if not url.endswith(suffix):
        url += suffix
    payload = {'model': model['modelCode']}
    if kind == 'LLM':
        payload.update(messages=[{'role': 'user', 'content': 'Reply with OK.'}], max_tokens=128, stream=False)
    else:
        payload['input'] = ['ByClaw deployment check']
        try:
            dimension = int(params['dimensions'])
            if dimension <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            return '待配置', 'Embedding 未设置有效向量维度。'
        payload['dimensions'] = dimension
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + model['authToken']}
    for item in params.get('headers', []):
        if item.get('key') and item.get('value'):
            headers[item['key']] = item['value']
    try:
        request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        opener = opener or urllib.request.build_opener(NoRedirect())
        with opener.open(request, timeout=40) as response:
            data = json.load(response)
        if kind == 'LLM':
            message = data['choices'][0]['message']
            if not isinstance(message.get('content'), str) or not message['content'].strip():
                return '失败', '请求完成但没有返回回答；检查模型协议或输出预算。'
            return '通过', '实际聊天请求成功（128 token 输出上限）。'
        rows = data['data']
        vector = rows[0]['embedding']
        if len(rows) != 1 or not isinstance(vector, list) or not all(type(v) in (int, float) and math.isfinite(v) for v in vector):
            return '失败', 'Embedding 返回格式或向量数值无效。'
        if len(vector) != dimension:
            return '失败', f'向量维度不匹配：配置 {dimension}，实际 {len(vector)}。'
        return '通过', f'实际 Embedding 请求成功，维度 {dimension}。'
    except urllib.error.HTTPError as error:
        detail = {401: '认证失败', 403: '无访问权限', 404: '模型或接口不存在',
                  429: '触发限流或额度限制'}.get(error.code, '上游接口拒绝请求')
        reason = upstream_error(error, list(headers.values()) + [model['authToken']])
        return '失败', f'{detail}（HTTP {error.code}）：{reason}'
    except TimeoutError:
        return '失败', '模型 HTTP 请求超过 40 秒未完成。'
    except urllib.error.URLError as error:
        return '失败', '模型网络连接失败：' + safe_message(error.reason, list(headers.values()))
    except Exception:
        return '失败', '配置或响应格式无效；检查模型协议。'


def decrypt_token(value):
    """Match Sm4Util ECB/PKCS5Padding, including legacy plaintext fallback."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives.padding import PKCS7
    if not value:
        return ''
    try:
        ciphertext = base64.b64decode(value, validate=True)
        # Public legacy format key from Sm4Util; not a deployment credential.
        key = bytes.fromhex('7734484041394b6c6d214530364f5e38')
        decryptor = Cipher(algorithms.SM4(key), modes.ECB()).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()
        unpadder = PKCS7(128).unpadder()
        return (unpadder.update(padded) + unpadder.finalize()).decode('utf-8')
    except (ValueError, UnicodeError):
        return value


def read_models():
    try:
        import psycopg
        from psycopg import sql
        from cryptography.hazmat.primitives.ciphers.algorithms import SM4
    except ImportError:
        return {'error': '缺少 psycopg/cryptography；在部署根目录执行 python3 -m venv .check-venv && .check-venv/bin/pip install -r deploy/check-requirements.txt 后重试。'}
    try:
        config = {}
        with psycopg.connect(host=os.getenv('DB_HOST', '127.0.0.1'),
                port=os.getenv('DB_PORT', '5432'), dbname=os.getenv('DB_DATABASE', 'postgres'),
                user=os.getenv('DB_USER', 'gaussdb'), password=os.getenv('DB_PASS', ''),
                connect_timeout=5, autocommit=True) as conn:
            with conn.cursor() as cursor:
                cursor.execute('SET default_transaction_read_only = on')
                cursor.execute('SET statement_timeout = 5000')
                schema = sql.Identifier(os.getenv('DB_SCHEMA', 'byai'))
                query = sql.SQL("""SELECT a.model_no, a.url, a.auth_token, a.in_params
                    FROM {}.byai_aimodel a
                    WHERE a.status = 'OOA' AND a.model_type = %s
                    AND (%s = 'EMBEDDING' OR EXISTS (SELECT 1 FROM {}.byai_tag_relation t
                        WHERE t.obj_id = a.model_id AND t.obj_type = 'AI_MODEL' AND t.tag_id = 1))
                    ORDER BY a.model_id""").format(schema, schema)
                for kind in ('LLM', 'EMBEDDING'):
                    cursor.execute(query, (kind, kind))
                    models = []
                    for code, url, token, params in cursor.fetchall():
                        try:
                            params = json.loads(params) if isinstance(params, str) and params else (params or {})
                            if not isinstance(params, dict):
                                raise ValueError()
                            models.append(dict(modelCode=code, url=url, authToken=decrypt_token(token), instanceParam=params))
                        except (ValueError, TypeError):
                            models.append({'configError': '数据库模型参数 in_params 不是有效 JSON 对象。'})
                    config[kind] = models
        return config
    except psycopg.Error as error:
        # Never emit connection strings, SQL parameters or credentials.
        state = error.sqlstate or ''
        detail = ('数据库认证失败，检查 DB_USER/DB_PASS。' if state.startswith('28') else
                  '数据库表或字段不存在，请检查初始化/迁移及 DB_SCHEMA。' if state in ('42P01', '42703', '3F000') else
                  '数据库查询超过 5 秒。' if state == '57014' else
                  '无法读取 OpenGauss 模型配置，检查 DB_HOST/DB_PORT、认证及数据库权限。')
        return {'error': detail + f'（{type(error).__name__}' + (f'，SQLSTATE {state}' if state else '') + '）'}
    except (ValueError, TypeError):
        return {'error': '数据库连接配置格式错误，请检查 .env 中 DB_* 配置。'}


def collect(config):
    if config.get('error'):
        return [[kind, '失败', config['error']] for kind in ('LLM', 'Embedding')]
    results = []
    for kind in ('LLM', 'EMBEDDING'):
        try:
            models = config.get(kind, [])
            if kind == 'LLM' and len(models) > 1:
                state, detail = '失败', '数据库中存在多个启用默认模型；请在模型管理中确认唯一默认模型。'
            elif not models:
                state = '待配置'
                detail = ('数据库中没有启用的默认 LLM；请在模型管理中启用并设为默认。'
                          if kind == 'LLM' else '数据库中没有启用的 EMBEDDING 类型模型；请在模型管理中配置并启用。')
            else:
                checks = [('失败', model['configError']) if model.get('configError') else probe(kind, model)
                          for model in models]
                state = next((status for status in ('失败', '待配置') if any(c[0] == status for c in checks)), '通过')
                detail = checks[0][1] if len(checks) == 1 else '；'.join(
                    f'{safe_message(model.get("modelCode") or "未命名模型")}: [{status}] {message}'
                    for model, (status, message) in zip(models, checks))
        except Exception as error:
            state, detail = '失败', f'数据库模型配置格式错误（{type(error).__name__}）。'
        results.append(['Embedding' if kind == 'EMBEDDING' else kind, state, detail])
    return results


if __name__ == '__main__':
    print(json.dumps(collect(read_models()), ensure_ascii=False))
