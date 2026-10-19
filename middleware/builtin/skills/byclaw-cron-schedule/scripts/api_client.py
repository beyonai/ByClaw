"""Minimal ByClaw transport using the runtime Beyond-Token contract."""
import os
from urllib.parse import urlsplit


class ScheduleError(Exception):
    """Safe user-facing error without response bodies or credentials."""


class OutcomeUnknown(ScheduleError):
    """A write may have reached the server; callers must reconcile, never retry blindly."""


def normalize_url(value):
    value = (value or '').strip().rstrip('/')
    if not value:
        raise ScheduleError('BYAI_SERVICE_BASE_URL is missing from the runtime environment.')
    try:
        parts = urlsplit(value)
        parts.port
    except ValueError:
        raise ScheduleError('BYAI_SERVICE_BASE_URL is not a valid HTTP(S) URL prefix.') from None
    if (parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password
            or parts.query or parts.fragment):
        raise ScheduleError('BYAI_SERVICE_BASE_URL must be HTTP(S), without credentials/query/fragment.')
    return value


class APIClient:
    def __init__(self, token=None, session=None, timeout=30):
        self.base_url = normalize_url(os.environ.get('BYAI_SERVICE_BASE_URL'))
        token = token or os.environ.get('BEYOND_TOKEN')
        if not token:
            raise ScheduleError('BEYOND_TOKEN is missing from the trusted runtime.')
        if session is None:
            try:
                import requests
            except ImportError:
                raise ScheduleError('Install scripts/requirements.txt in the execution environment.') from None
            session = requests.Session()
        self.session = session
        self.session.trust_env = False
        self.session.headers.update({'Beyond-Token': token, 'Accept': 'application/json'})
        self.timeout = timeout

    def post(self, path, payload, *, write=False):
        if not path.startswith('/') or path.startswith('//') or '://' in path:
            raise ScheduleError('API path must be relative to the trusted service.')
        try:
            response = self.session.request(
                'POST', self.base_url + path, json=payload, timeout=self.timeout, allow_redirects=False)
            if not 200 <= response.status_code < 300:
                error = f'HTTP {response.status_code} at {path}.'
                if write and response.status_code >= 500:
                    raise OutcomeUnknown(error + ' Write outcome may be unknown.')
                raise ScheduleError(error)
            body = response.json()
            if not isinstance(body, dict) or body.get('code') not in (0, '0') or 'data' not in body:
                message = body.get('msg') if isinstance(body, dict) else None
                raise ScheduleError(f'Business error at {path}' + (f': {message}' if message else '.'))
            return body['data']
        except (ScheduleError, OutcomeUnknown):
            raise
        except Exception:
            error = f'Transport/JSON failure at {path}.'
            if write:
                raise OutcomeUnknown(error + ' Write outcome may be unknown.') from None
            raise ScheduleError(error) from None

    def pages(self, path, payload, *, row_key=None):
        rows, seen = [], set()
        for page in range(1, 10001):
            data = self.post(path, {**payload, 'pageNum': page, 'pageSize': 100})
            if not isinstance(data, dict) or not isinstance(data.get('list'), list):
                raise ScheduleError(f'Incomplete pagination data at {path}.')
            batch = data['list']
            for index, row in enumerate(batch):
                if not isinstance(row, dict):
                    raise ScheduleError(f'Malformed paginated row at {path}.')
                if row_key:
                    if row.get(row_key) is None:
                        raise ScheduleError(f'Missing {row_key} in paginated row at {path}.')
                    key = str(row[row_key])
                    if key in seen:
                        raise ScheduleError(f'Repeated {row_key} at {path}; pagination is unstable.')
                    seen.add(key)
                rows.append(row)
            total_pages = data.get('totalPages')
            total = data.get('total')
            if not isinstance(total_pages, int) or not isinstance(total, int) or total_pages < 0:
                raise ScheduleError(f'Incomplete pagination metadata at {path}.')
            if page >= total_pages:
                if len(rows) != total:
                    raise ScheduleError(f'Pagination count changed at {path}; query again before writing.')
                return rows
            if not batch:
                raise ScheduleError(f'Unexpected empty page at {path}.')
        raise ScheduleError(f'Pagination exceeded limit at {path}.')
