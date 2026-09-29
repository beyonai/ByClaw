#!/usr/bin/env python3
"""Plan, apply, and inspect ByClaw chat schedule tasks."""
import argparse
import calendar
import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from api_client import APIClient, OutcomeUnknown, ScheduleError

TASK_LIST = '/devloop/source/list'
TASK_CREATE = '/devloop/source/create'
TASK_UPDATE = '/devloop/source/update'
TASK_DELETE = '/devloop/source/delete'
TASK_TOGGLE = '/devloop/source/toggle'
TASK_RUN = '/devloop/source/scan'
RUN_LIST = '/devloop/automation/run/list'
PROJECT_LIST = '/project/list'
EMPLOYEE_LIST = '/api/v2/digitEmploy/discover'
ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
SCHEDULE_DIRECTIVE_PATTERNS = (
    re.compile(r'每\s*(?:间隔\s*)?(?:\d+(?:\.\d+)?\s*)?(?:分钟|小时|天|周|月)\s*'
               r'(?:执行|运行|触发)(?:\s*一?次)?(?:\s*[。；;,.!！]|\s*$)', re.IGNORECASE),
    re.compile(r'(?:创建|新增|生成|设置|配置).{0,20}(?:定时任务|计划任务|cron\s*(?:job|task)?)', re.IGNORECASE),
    re.compile(r'every\s+\d+(?:\.\d+)?\s*(?:minutes?|hours?|days?|weeks?|months?)\s+'
               r'(?:run|execute|trigger)(?:\s+once)?(?:\s*[.;,!]|\s*$)', re.IGNORECASE),
)


def identifier(value, field='id'):
    if isinstance(value, bool) or value is None:
        raise ScheduleError(f'{field} must be an integer identifier.')
    text = str(value).strip()
    if not text.isdigit():
        raise ScheduleError(f'{field} must be an integer identifier.')
    return text


def required_text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ScheduleError(f'{field} must be a non-empty string.')
    return value.strip()


def validate_prompt(value, allow_schedule_directive=False):
    prompt = required_text(value, 'prompt')
    if not allow_schedule_directive and any(pattern.search(prompt) for pattern in SCHEDULE_DIRECTIVE_PATTERNS):
        raise ScheduleError(
            'prompt appears to contain a scheduling directive. Keep execution frequency in schedule, '
            'remove it from prompt, or set allowScheduleDirectiveInPrompt=true only when the business task '
            'must manage schedules.'
        )
    return prompt


def optional_project_id(value):
    if value is None or str(value).strip() == '-1':
        return None
    return identifier(value, 'projectId')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def plan_hash(plan):
    return hashlib.sha256(canonical(plan).encode()).hexdigest()


def weekdays(value, field):
    values = ALL_WEEKDAYS if value is None else value
    if not isinstance(values, list) or not values:
        raise ScheduleError(f'{field} must be a non-empty array.')
    result = []
    for item in values:
        if isinstance(item, bool) or not isinstance(item, int) or item < 1 or item > 7:
            raise ScheduleError(f'{field} values must be integers from 1 to 7.')
        if item not in result:
            result.append(item)
    return sorted(result)


def parse_time(value):
    value = required_text(value, 'schedule.time')
    try:
        parsed = datetime.strptime(value, '%H:%M')
    except ValueError:
        raise ScheduleError('schedule.time must use HH:mm.') from None
    return parsed.hour, parsed.minute, value


def normalize_schedule(raw):
    if not isinstance(raw, dict):
        raise ScheduleError('schedule must be an object.')
    mode = required_text(raw.get('mode'), 'schedule.mode').lower()
    if mode == 'once':
        once_time = required_text(raw.get('onceTime'), 'schedule.onceTime')
        try:
            parsed = datetime.strptime(once_time, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            raise ScheduleError('schedule.onceTime must use yyyy-MM-dd HH:mm:ss.') from None
        schedule = {'mode': 'once', 'onceTime': once_time}
        return schedule, f'{parsed.minute} {parsed.hour} {parsed.day} {parsed.month} *'
    if mode == 'interval':
        unit = required_text(raw.get('intervalUnit', 'hour'), 'schedule.intervalUnit').lower()
        if unit not in ('hour', 'minute'):
            raise ScheduleError('schedule.intervalUnit must be hour or minute.')
        try:
            value = Decimal(str(raw.get('intervalValue')))
        except (InvalidOperation, TypeError):
            raise ScheduleError('schedule.intervalValue must be numeric.') from None
        if unit == 'minute':
            if value < 60 or value != value.to_integral_value():
                raise ScheduleError('Minute intervals must be integers of at least 60.')
        elif value < 1 or -value.as_tuple().exponent > 1:
            raise ScheduleError('Hour intervals must be at least 1 with at most one decimal place.')
        allowed_days = weekdays(raw.get('intervalWeekdays'), 'schedule.intervalWeekdays')
        number = int(value) if value == value.to_integral_value() else float(value)
        schedule = {'mode': 'interval', 'intervalValue': number, 'intervalUnit': unit,
                    'intervalWeekdays': allowed_days}
        if unit == 'hour':
            schedule['intervalHours'] = number
        day_field = ','.join(map(str, allowed_days))
        if unit == 'minute' or value != value.to_integral_value():
            cron = f'* * * * {day_field}'
        elif int(value) <= 23:
            cron = f'0 */{int(value)} * * {day_field}'
        else:
            cron = f'0 * * * {day_field}'
        return schedule, cron
    if mode != 'periodic':
        raise ScheduleError('schedule.mode must be periodic, interval, or once.')
    period = required_text(raw.get('periodType'), 'schedule.periodType').lower()
    if period not in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly'):
        raise ScheduleError('Unsupported schedule.periodType.')
    hour, minute, time_text = parse_time(raw.get('time'))
    schedule = {'mode': 'periodic', 'periodType': period, 'time': time_text}
    if period in ('weekly', 'biweekly'):
        values = weekdays(raw.get('weekdays'), 'schedule.weekdays')
        schedule['weekdays'] = values
        cron = f'{minute} {hour} * * ' + ','.join(map(str, values))
    elif period == 'monthly':
        values = raw.get('monthDays')
        if not isinstance(values, list) or not values:
            raise ScheduleError('schedule.monthDays must be a non-empty array.')
        if any(isinstance(day, bool) or not isinstance(day, int) or day < 1 or day > 31 for day in values):
            raise ScheduleError('schedule.monthDays values must be integers from 1 to 31.')
        days = sorted(set(values))
        schedule['monthDays'] = days
        schedule['monthDay'] = days[0]
        cron = f'{minute} {hour} ' + ','.join(map(str, days)) + ' * *'
    elif period == 'yearly':
        month, day = raw.get('month'), raw.get('monthDay')
        if (isinstance(month, bool) or not isinstance(month, int) or month < 1 or month > 12
                or isinstance(day, bool) or not isinstance(day, int)
                or day < 1 or day > calendar.monthrange(2024, month)[1]):
            raise ScheduleError('schedule.month/monthDay is not a valid calendar date.')
        schedule.update(month=month, monthDay=day)
        cron = f'{minute} {hour} {day} {month} *'
    else:
        cron = f'{minute} {hour} * * *'
    return schedule, cron


def parse_config(source):
    try:
        config = json.loads(source.get('config') or '{}')
    except (TypeError, json.JSONDecodeError):
        raise ScheduleError(f'Task {source.get("sourceId")} has invalid config JSON.') from None
    if not isinstance(config, dict):
        raise ScheduleError(f'Task {source.get("sourceId")} config must be an object.')
    resources = config.get('resourceList')
    config['resourceList'] = resources if isinstance(resources, list) else []
    if any(not isinstance(resource, dict) for resource in config['resourceList']):
        raise ScheduleError(f'Task {source.get("sourceId")} has malformed resourceList entries.')
    return config


class CronSchedule:
    def __init__(self, api):
        self.api = api

    def tasks(self, keyword=None, project_id=None):
        payload = {'onlyMine': True}
        if keyword:
            payload['keyword'] = keyword
        project_id = optional_project_id(project_id)
        if project_id is not None:
            payload['projectId'] = int(project_id)
        rows = self.api.pages(TASK_LIST, payload, row_key='sourceId')
        return [row for row in rows if row.get('sourceType') == 'chat']

    def task(self, source_id):
        wanted = identifier(source_id, 'sourceId')
        matches = [row for row in self.tasks() if str(row.get('sourceId')) == wanted]
        if len(matches) != 1:
            raise ScheduleError('Task is not a unique current-user chat schedule.')
        return matches[0]

    def runs(self, status=None, keyword=None):
        payload = {}
        if status:
            if status not in ('success', 'failed', 'running'):
                raise ScheduleError('status must be success, failed, or running.')
            payload['status'] = status
        if keyword:
            payload['keyword'] = keyword
        return self.api.pages(RUN_LIST, payload, row_key='logId')

    def projects(self, keyword=None):
        payload = {'keyword': keyword} if keyword else {}
        return self.api.pages(PROJECT_LIST, payload, row_key='projectId')

    def employees(self, keyword=None):
        rows = self.api.pages(EMPLOYEE_LIST, {'resourceStatus': 2, 'orderField': 'updateTime', 'orderBy': 'desc'},
                              row_key='resourceId')
        result = []
        needle = keyword.casefold() if keyword else None
        for row in rows:
            name = str(row.get('resourceName') or row.get('name') or '')
            if row.get('resourceBizType') != 'DIG_EMPLOYEE' or str(row.get('resourceStatus')) != '2':
                continue
            if needle and needle not in name.casefold() and needle not in str(row.get('resourceCode') or '').casefold():
                continue
            result.append({'resourceId': str(row['resourceId']), 'resourceName': name,
                           'resourceCode': row.get('resourceCode'), 'resourceStatus': row.get('resourceStatus')})
        return result

    def employee(self, resource_id, expected_name=None):
        wanted = identifier(resource_id, 'employeeId')
        matches = [row for row in self.employees() if row['resourceId'] == wanted]
        if len(matches) != 1:
            raise ScheduleError('Employee is not uniquely discoverable and active for the current identity.')
        if expected_name is not None and required_text(expected_name, 'employeeName') != matches[0]['resourceName']:
            raise ScheduleError('employeeName does not match the currently discovered employee.')
        return matches[0]

    def project(self, project_id):
        wanted = identifier(project_id, 'projectId')
        matches = [row for row in self.projects() if str(row.get('projectId')) == wanted]
        if len(matches) != 1:
            raise ScheduleError('Project is not uniquely visible to the current identity.')
        return {'projectId': wanted, 'projectName': matches[0].get('projectName')}

    @staticmethod
    def employee_resource(employee):
        resource_id = employee['resourceId']
        return {'id': 'DIG_EMPLOYEE_' + resource_id, 'resourceId': resource_id,
                'resourceName': employee.get('resourceName') or '', 'resourceType': 'DIG_EMPLOYEE'}

    @staticmethod
    def validate_handler(resources):
        for resource in reversed(resources):
            if resource.get('resourceType') == 'DIG_EMPLOYEE':
                identifier(resource.get('resourceId'), 'resourceList employee resourceId')
                return
        raise ScheduleError('Task config must contain a digital employee handler.')

    @staticmethod
    def before(source):
        return {key: source.get(key) for key in
                ('sourceId', 'sourceName', 'sourceType', 'projectId', 'cronExpr', 'config', 'enabled', 'lastScanTime')}

    @staticmethod
    def confirmation(plan):
        action = plan['action']
        summary = {'action': action, 'target': plan['target']}
        if action in ('create', 'update'):
            config = json.loads(plan['payload']['config'])
            employee = next((row for row in reversed(config['resourceList'])
                             if row.get('resourceType') == 'DIG_EMPLOYEE'), None)
            summary.update({
                'name': plan['payload']['sourceName'],
                'prompt': config['chatContent'],
                'employee': employee,
                'project': plan.get('project') if action == 'create' else {
                    'projectId': plan['before'].get('projectId')},
                'schedule': config.get('schedule'),
                'cronExpr': plan['payload']['cronExpr'],
            })
            if action == 'create':
                summary['sameNameTaskIds'] = plan.get('sameNameTaskIds', [])
        elif action in ('pause', 'resume'):
            summary['enabled'] = plan['payload']['enabled']

        effect = {
            'create': '确认后将创建新的定时任务。',
            'update': '确认后将覆盖目标任务计划中列出的字段。',
            'pause': '确认后将暂停目标任务。',
            'resume': '确认后将恢复目标任务。',
            'delete': '确认后将软删除目标任务；当前没有恢复 API。',
            'run': '确认后将立即创建执行会话，并绕过启用状态与到期判断。',
        }[action]
        constraints = [
            effect,
            '确认仅适用于当前完整计划和 planHash；请求或远端状态变化后必须重新确认。',
        ]
        if action in ('create', 'update'):
            constraints.append('prompt 会在每次触发时交给数字员工执行，调度仅由 schedule 与 cronExpr 表达。')
        constraints.append('API 写入或下发成功不代表数字员工已经执行完成。')
        return {'required': True, 'summary': summary, 'constraints': constraints}

    def build_plan(self, request):
        if not isinstance(request, dict):
            raise ScheduleError('Request must be a JSON object.')
        action = required_text(request.get('action'), 'action').lower()
        if action == 'create':
            name = required_text(request.get('name'), 'name')
            same_name = [row for row in self.tasks() if row.get('sourceName') == name]
            if same_name and request.get('allowDuplicateName') is not True:
                ids = ', '.join(str(row.get('sourceId')) for row in same_name)
                raise ScheduleError(f'A same-name chat task already exists: {ids}.')
            prompt = validate_prompt(request.get('prompt'), request.get('allowScheduleDirectiveInPrompt') is True)
            employee = self.employee(request.get('employeeId'), request.get('employeeName'))
            schedule, cron = normalize_schedule(request.get('schedule'))
            project_id = optional_project_id(request.get('projectId'))
            project = self.project(project_id) if project_id is not None else None
            config = {'chatContent': prompt, 'resourceList': [self.employee_resource(employee)], 'schedule': schedule}
            payload = {'sourceName': name, 'sourceType': 'chat', 'cronExpr': cron, 'config': canonical(config)}
            if project:
                payload['projectId'] = int(project['projectId'])
            plan = {'action': action, 'target': {'sourceId': None, 'sourceName': name}, 'employee': employee,
                    'project': project, 'payload': payload, 'before': None,
                    'sameNameTaskIds': [str(row.get('sourceId')) for row in same_name]}
        else:
            source = self.task(request.get('sourceId'))
            source_id = int(identifier(source.get('sourceId'), 'sourceId'))
            if action == 'update':
                config = parse_config(source)
                name = required_text(request.get('name', source.get('sourceName')), 'name')
                prompt = validate_prompt(request.get('prompt', config.get('chatContent')),
                                         request.get('allowScheduleDirectiveInPrompt') is True)
                if 'schedule' in request:
                    schedule, cron = normalize_schedule(request['schedule'])
                    config['schedule'] = schedule
                else:
                    cron = required_text(source.get('cronExpr'), 'existing cronExpr')
                employee = None
                if 'employeeName' in request and 'employeeId' not in request:
                    raise ScheduleError('employeeName requires employeeId.')
                if 'employeeId' in request:
                    employee = self.employee(request.get('employeeId'), request.get('employeeName'))
                    config['resourceList'] = [row for row in config['resourceList']
                                              if row.get('resourceType') != 'DIG_EMPLOYEE']
                    config['resourceList'].append(self.employee_resource(employee))
                config['chatContent'] = prompt
                self.validate_handler(config['resourceList'])
                payload = {'sourceId': source_id, 'sourceName': name, 'cronExpr': cron,
                           'config': canonical(config)}
                plan = {'action': action, 'target': {'sourceId': str(source_id), 'sourceName': source.get('sourceName')},
                        'employee': employee, 'project': None, 'payload': payload, 'before': self.before(source),
                        'noOp': self.matches(source, payload)}
            elif action in ('pause', 'resume'):
                payload = {'sourceId': source_id, 'enabled': '0' if action == 'pause' else '1'}
                plan = {'action': action, 'target': {'sourceId': str(source_id), 'sourceName': source.get('sourceName')},
                        'payload': payload, 'before': self.before(source),
                        'noOp': source.get('enabled') == payload['enabled']}
            elif action in ('delete', 'run'):
                plan = {'action': action, 'target': {'sourceId': str(source_id), 'sourceName': source.get('sourceName')},
                        'payload': {'sourceId': source_id}, 'before': self.before(source)}
            else:
                raise ScheduleError('action must be create, update, pause, resume, delete, or run.')
        plan['confirmation'] = self.confirmation(plan)
        plan['planHash'] = plan_hash(plan)
        return plan

    @staticmethod
    def matches(source, payload):
        for field in ('sourceName', 'sourceType', 'projectId', 'cronExpr', 'config', 'enabled'):
            if field in payload and source.get(field) != payload[field]:
                return False
        return True

    def reconcile(self, plan):
        source_id = plan['target'].get('sourceId')
        if plan['action'] == 'create':
            return [row for row in self.tasks() if row.get('sourceName') == plan['payload']['sourceName']
                    and self.matches(row, plan['payload'])]
        matches = [row for row in self.tasks() if str(row.get('sourceId')) == str(source_id)]
        if plan['action'] == 'delete':
            return {'deleted': not matches, 'matches': matches}
        return matches

    def apply(self, request, accepted_hash, user_confirmed=False):
        plan = self.build_plan(request)
        if accepted_hash != plan['planHash']:
            raise ScheduleError('Plan hash does not match current request and remote state; review a new plan.')
        action, payload = plan['action'], plan['payload']
        if not user_confirmed:
            raise ScheduleError(
                f'{action} requires explicit user confirmation of the current plan. '
                'Present confirmation and planHash, wait for a new user confirmation, then apply with '
                '--confirmed-by-user.'
            )
        if plan.get('noOp'):
            return {'status': 'verified', 'action': action, 'noOp': True,
                    'task': self.task(payload['sourceId'])}
        path = {'create': TASK_CREATE, 'update': TASK_UPDATE, 'pause': TASK_TOGGLE, 'resume': TASK_TOGGLE,
                'delete': TASK_DELETE, 'run': TASK_RUN}[action]
        before_runs = {str(row.get('logId')) for row in self.runs()} if action == 'run' else set()
        try:
            data = self.api.post(path, payload, write=True)
        except OutcomeUnknown as error:
            if action == 'run':
                new_runs = [row for row in self.runs() if str(row.get('logId')) not in before_runs
                            and str(row.get('sourceId')) == plan['target']['sourceId']]
                return {'status': 'dispatched' if new_runs else 'unknown', 'action': action,
                        'error': str(error), 'run': new_runs[0] if new_runs else None,
                        'completionVerified': False}
            reconciliation = self.reconcile(plan)
            verified = ((action == 'create' and len(reconciliation) == 1)
                        or (action == 'delete' and reconciliation['deleted'])
                        or (action in ('update', 'pause', 'resume') and len(reconciliation) == 1
                            and self.matches(reconciliation[0], payload)))
            return {'status': 'verified' if verified else 'unknown', 'action': action,
                    'error': str(error), 'reconciliation': reconciliation}
        if action == 'create':
            if not isinstance(data, dict) or data.get('sourceId') is None:
                raise ScheduleError('Create response did not include sourceId.')
            source = self.task(data['sourceId'])
            if not self.matches(source, payload):
                raise ScheduleError('Created task readback does not match the accepted plan.')
            return {'status': 'verified', 'action': action, 'task': source}
        if action in ('update', 'pause', 'resume'):
            source = self.task(payload['sourceId'])
            if not self.matches(source, payload):
                raise ScheduleError('Task readback does not match the accepted plan.')
            return {'status': 'verified', 'action': action, 'task': source}
        if action == 'delete':
            reconciliation = self.reconcile(plan)
            if not reconciliation['deleted']:
                raise ScheduleError('Deleted task is still visible in readback.')
            return {'status': 'verified', 'action': action, 'sourceId': plan['target']['sourceId']}
        new_runs = [row for row in self.runs() if str(row.get('logId')) not in before_runs
                    and str(row.get('sourceId')) == plan['target']['sourceId']]
        return {'status': 'dispatched' if new_runs else 'accepted', 'action': action,
                'sourceId': plan['target']['sourceId'], 'apiResult': data,
                'run': new_runs[0] if new_runs else None,
                'completionVerified': False}


def load_request(path):
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        raise ScheduleError('Request file is missing or invalid JSON.') from None
    if not isinstance(value, dict):
        raise ScheduleError('Request file must contain one JSON object.')
    return value


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest='command', required=True)
    listing = commands.add_parser('list')
    listing.add_argument('--keyword')
    listing.add_argument('--project-id')
    listing.add_argument('--source-id')
    runs = commands.add_parser('runs')
    runs.add_argument('--status', choices=['success', 'failed', 'running'])
    runs.add_argument('--keyword')
    employees = commands.add_parser('employees')
    employees.add_argument('--keyword')
    projects = commands.add_parser('projects')
    projects.add_argument('--keyword')
    plan = commands.add_parser('plan')
    plan.add_argument('--request', required=True)
    apply = commands.add_parser('apply')
    apply.add_argument('--request', required=True)
    apply.add_argument('--accept-plan', required=True)
    apply.add_argument('--confirmed-by-user', action='store_true')
    return root


def main(argv=None, api=None):
    args = parser().parse_args(argv)
    try:
        worker = CronSchedule(api or APIClient())
        if args.command == 'list':
            result = worker.tasks(args.keyword, args.project_id)
            if args.source_id:
                wanted = identifier(args.source_id, 'sourceId')
                result = [row for row in result if str(row.get('sourceId')) == wanted]
        elif args.command == 'runs':
            result = worker.runs(args.status, args.keyword)
        elif args.command == 'employees':
            result = worker.employees(args.keyword)
        elif args.command == 'projects':
            result = worker.projects(args.keyword)
        elif args.command == 'plan':
            result = worker.build_plan(load_request(args.request))
        else:
            result = worker.apply(load_request(args.request), args.accept_plan, args.confirmed_by_user)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ScheduleError as error:
        print(json.dumps({'status': 'blocked', 'error': str(error)}, ensure_ascii=False, indent=2))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
