"""Executed inside QA: credentials stay inside the application container."""
import asyncio
import contextlib
import io
import json
import math
import sys
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


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
        return '失败', f'{detail}（HTTP {error.code}）；检查应用生效配置。'
    except (TimeoutError, urllib.error.URLError):
        return '失败', '连接失败或超时；检查应用容器网络、代理和模型地址。'
    except Exception:
        return '失败', '配置或响应格式无效；检查模型协议。'


async def collect():
    sys.path.insert(0, '/app/src')
    from redis_model_config import RedisModelConfigProvider
    provider = RedisModelConfigProvider()
    results = []
    try:
        await asyncio.wait_for(provider.load_cache(), timeout=10)
        for kind in ('LLM', 'EMBEDDING'):
            models = provider._models_by_type.get(kind, [])
            model = next((m for m in models if str(m.get('isDefault')) == '1'), models[0] if models else None)
            state, detail = await asyncio.to_thread(probe, kind, model)
            results.append([kind, state, detail])
    except Exception:
        results = [[kind, '失败', '无法读取应用 Redis 模型配置；请检查 Redis 连接与 BE 模型同步。'] for kind in ('LLM', 'Embedding')]
    return results


if __name__ == '__main__':
    # Imported application loggers can emit config. Only return our fixed-schema report.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            results = asyncio.run(collect())
        except Exception:
            results = [[kind, '失败', 'QA 模型配置读取环境不可用。'] for kind in ('LLM', 'Embedding')]
    print(json.dumps(results, ensure_ascii=False))
