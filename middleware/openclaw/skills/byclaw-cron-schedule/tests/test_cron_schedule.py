"""Offline contract tests: python -m unittest discover -s tests -v."""
import copy
import json
import sys
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))

from api_client import OutcomeUnknown, ScheduleError  # noqa: E402
from cron_schedule import (  # noqa: E402
    CronSchedule,
    EMPLOYEE_LIST,
    PROJECT_LIST,
    RUN_LIST,
    TASK_CREATE,
    TASK_DELETE,
    TASK_LIST,
    TASK_RUN,
    TASK_TOGGLE,
    TASK_UPDATE,
    normalize_schedule,
)


class FakeAPI:
    def __init__(self):
        self.calls = []
        self.tasks = [
            {'sourceId': 1, 'sourceName': 'Existing', 'sourceType': 'chat', 'projectId': 10,
             'cronExpr': '0 9 * * *', 'enabled': '1', 'lastScanTime': None,
             'config': json.dumps({'chatContent': 'old', 'resourceList': [
                 {'id': 'SKILL_8', 'resourceId': '8', 'resourceType': 'SKILL'},
                 {'id': 'DIG_EMPLOYEE_20', 'resourceId': '20', 'resourceName': 'Old Agent',
                  'resourceType': 'DIG_EMPLOYEE'}],
                 'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '09:00'}},
                 ensure_ascii=False, sort_keys=True, separators=(',', ':'))},
            {'sourceId': 2, 'sourceName': 'GitHub', 'sourceType': 'github_issue', 'enabled': '1',
             'cronExpr': '0 9 * * *', 'config': '{}'},
        ]
        self.employees = [
            {'resourceId': 20, 'resourceName': 'Old Agent', 'resourceCode': 'old',
             'resourceBizType': 'DIG_EMPLOYEE', 'resourceStatus': 2},
            {'resourceId': 21, 'resourceName': 'New Agent', 'resourceCode': 'new',
             'resourceBizType': 'DIG_EMPLOYEE', 'resourceStatus': 2},
        ]
        self.projects = [{'projectId': 10, 'projectName': 'Default'}]
        self.run_rows = []
        self.fail_path = None
        self.fail_after_write = False

    def pages(self, path, payload, row_key=None):
        self.calls.append(('pages', path, copy.deepcopy(payload)))
        if path == TASK_LIST:
            return copy.deepcopy(self.tasks)
        if path == EMPLOYEE_LIST:
            return copy.deepcopy(self.employees)
        if path == PROJECT_LIST:
            return copy.deepcopy(self.projects)
        if path == RUN_LIST:
            return copy.deepcopy(self.run_rows)
        raise AssertionError(path)

    def post(self, path, payload, write=False):
        self.calls.append(('post', path, copy.deepcopy(payload)))
        result = None
        if path == TASK_CREATE:
            source_id = max(row['sourceId'] for row in self.tasks) + 1
            self.tasks.append({**copy.deepcopy(payload), 'sourceId': source_id, 'enabled': '1',
                               'lastScanTime': None})
            result = {'sourceId': source_id}
        elif path == TASK_UPDATE:
            self._task(payload['sourceId']).update(copy.deepcopy(payload))
        elif path == TASK_TOGGLE:
            self._task(payload['sourceId'])['enabled'] = payload['enabled']
        elif path == TASK_DELETE:
            self.tasks = [row for row in self.tasks if row['sourceId'] != payload['sourceId']]
        elif path == TASK_RUN:
            source = self._task(payload['sourceId'])
            self.run_rows.insert(0, {'logId': 100 + len(self.run_rows), 'sourceId': source['sourceId'],
                                     'sourceName': source['sourceName'], 'status': 'success', 'sessionId': 200})
            result = {'createdCount': 0}
        else:
            raise AssertionError(path)
        if self.fail_path == path:
            if not self.fail_after_write:
                raise OutcomeUnknown('unknown')
            raise OutcomeUnknown('unknown')
        return result

    def _task(self, source_id):
        return next(row for row in self.tasks if row['sourceId'] == source_id)


class ScheduleTests(unittest.TestCase):
    def test_schedule_contracts(self):
        schedule, cron = normalize_schedule(
            {'mode': 'interval', 'intervalValue': 1.5, 'intervalUnit': 'hour',
             'intervalWeekdays': [5, 1, 5]})
        self.assertEqual(cron, '* * * * 1,5')
        self.assertEqual(schedule['intervalHours'], 1.5)
        self.assertEqual(normalize_schedule(
            {'mode': 'periodic', 'periodType': 'monthly', 'time': '08:15',
             'monthDays': [18, 2, 18]})[1], '15 8 2,18 * *')
        self.assertEqual(normalize_schedule(
            {'mode': 'once', 'onceTime': '2026-10-01 09:30:00'})[1], '30 9 1 10 *')

    def test_invalid_intervals_are_rejected(self):
        for value in (59, 60.5):
            with self.subTest(value=value), self.assertRaises(ScheduleError):
                normalize_schedule({'mode': 'interval', 'intervalValue': value, 'intervalUnit': 'minute'})
        for value in (0.9, 1.25):
            with self.subTest(value=value), self.assertRaises(ScheduleError):
                normalize_schedule({'mode': 'interval', 'intervalValue': value, 'intervalUnit': 'hour'})

    def test_list_filters_non_chat_sources(self):
        worker = CronSchedule(FakeAPI())
        self.assertEqual([row['sourceId'] for row in worker.tasks()], [1])
        call = worker.api.calls[0]
        self.assertTrue(call[2]['onlyMine'])

    def test_create_plan_and_apply_are_verified(self):
        api = FakeAPI()
        worker = CronSchedule(api)
        request = {'action': 'create', 'name': 'Daily', 'prompt': 'Summarize', 'employeeId': '21',
                   'projectId': '10',
                   'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '08:30'}}
        plan = worker.build_plan(request)
        self.assertEqual(plan['payload']['sourceType'], 'chat')
        self.assertEqual(plan['payload']['cronExpr'], '30 8 * * *')
        config = json.loads(plan['payload']['config'])
        self.assertEqual(config['resourceList'][-1]['resourceId'], '21')
        self.assertTrue(plan['confirmation']['required'])
        self.assertEqual(plan['confirmation']['summary']['prompt'], 'Summarize')
        result = worker.apply(request, plan['planHash'], user_confirmed=True)
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['task']['sourceName'], 'Daily')

    def test_all_write_actions_require_user_confirmation(self):
        requests = [
            {'action': 'create', 'name': 'Daily', 'prompt': 'Summarize', 'employeeId': '21',
             'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '08:30'}},
            {'action': 'update', 'sourceId': '1', 'prompt': 'new prompt'},
            {'action': 'pause', 'sourceId': '1'},
            {'action': 'resume', 'sourceId': '1'},
            {'action': 'delete', 'sourceId': '1'},
            {'action': 'run', 'sourceId': '1'},
        ]
        for request in requests:
            with self.subTest(action=request['action']):
                api = FakeAPI()
                worker = CronSchedule(api)
                plan = worker.build_plan(request)
                self.assertTrue(plan['confirmation']['required'])
                self.assertEqual(plan['confirmation']['summary']['action'], request['action'])
                with self.assertRaisesRegex(ScheduleError, 'explicit user confirmation'):
                    worker.apply(request, plan['planHash'])
                self.assertFalse(any(call[0] == 'post' for call in api.calls))

    def test_project_minus_one_is_treated_as_no_project(self):
        api = FakeAPI()
        worker = CronSchedule(api)
        request = {'action': 'create', 'name': 'No Project', 'prompt': 'Summarize', 'employeeId': '21',
                   'projectId': -1,
                   'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '08:30'}}
        plan = worker.build_plan(request)
        self.assertNotIn('projectId', plan['payload'])
        self.assertIsNone(plan['project'])
        self.assertFalse(any(call[1] == PROJECT_LIST for call in api.calls))

    def test_project_minus_one_is_not_sent_when_listing(self):
        api = FakeAPI()
        CronSchedule(api).tasks(project_id='-1')
        self.assertNotIn('projectId', api.calls[0][2])

    def test_schedule_directive_in_prompt_requires_explicit_override(self):
        worker = CronSchedule(FakeAPI())
        request = {'action': 'create', 'name': 'Issue Stats',
                   'prompt': '统计 open、closed issue 数量。每间隔60分钟执行一次。',
                   'employeeId': '21',
                   'schedule': {'mode': 'interval', 'intervalValue': 60, 'intervalUnit': 'minute'}}
        with self.assertRaisesRegex(ScheduleError, 'scheduling directive'):
            worker.build_plan(request)
        request['allowScheduleDirectiveInPrompt'] = True
        self.assertEqual(worker.build_plan(request)['payload']['sourceName'], 'Issue Stats')

    def test_same_name_create_requires_explicit_override(self):
        worker = CronSchedule(FakeAPI())
        request = {'action': 'create', 'name': 'Existing', 'prompt': 'Summarize', 'employeeId': '21',
                   'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '08:30'}}
        with self.assertRaisesRegex(ScheduleError, 'same-name'):
            worker.build_plan(request)
        request['allowDuplicateName'] = True
        self.assertEqual(worker.build_plan(request)['sameNameTaskIds'], ['1'])

    def test_update_preserves_non_employee_resources_and_replaces_handler(self):
        api = FakeAPI()
        worker = CronSchedule(api)
        request = {'action': 'update', 'sourceId': '1', 'prompt': 'new prompt', 'employeeId': '21'}
        plan = worker.build_plan(request)
        config = json.loads(plan['payload']['config'])
        self.assertEqual([row['resourceType'] for row in config['resourceList']], ['SKILL', 'DIG_EMPLOYEE'])
        self.assertEqual(config['resourceList'][-1]['resourceId'], '21')
        result = worker.apply(request, plan['planHash'], user_confirmed=True)
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(json.loads(result['task']['config'])['chatContent'], 'new prompt')

    def test_remote_change_invalidates_plan_hash(self):
        api = FakeAPI()
        worker = CronSchedule(api)
        request = {'action': 'pause', 'sourceId': '1'}
        plan = worker.build_plan(request)
        api.tasks[0]['lastScanTime'] = '2026-09-29 09:00:00'
        with self.assertRaisesRegex(ScheduleError, 'Plan hash'):
            worker.apply(request, plan['planHash'])
        self.assertFalse(any(call[0] == 'post' for call in api.calls))

    def test_pause_is_noop_when_already_paused(self):
        api = FakeAPI()
        api.tasks[0]['enabled'] = '0'
        worker = CronSchedule(api)
        request = {'action': 'pause', 'sourceId': '1'}
        plan = worker.build_plan(request)
        self.assertTrue(plan['noOp'])
        result = worker.apply(request, plan['planHash'], user_confirmed=True)
        self.assertTrue(result['noOp'])
        self.assertFalse(any(call[0] == 'post' for call in api.calls))

    def test_run_reports_dispatch_not_completion(self):
        api = FakeAPI()
        worker = CronSchedule(api)
        request = {'action': 'run', 'sourceId': '1'}
        plan = worker.build_plan(request)
        result = worker.apply(request, plan['planHash'], user_confirmed=True)
        self.assertEqual(result['status'], 'dispatched')
        self.assertFalse(result['completionVerified'])
        self.assertEqual(result['run']['sessionId'], 200)

    def test_unknown_create_is_reconciled_without_retry(self):
        api = FakeAPI()
        api.fail_path = TASK_CREATE
        worker = CronSchedule(api)
        request = {'action': 'create', 'name': 'Daily', 'prompt': 'Summarize', 'employeeId': '21',
                   'schedule': {'mode': 'periodic', 'periodType': 'daily', 'time': '08:30'}}
        plan = worker.build_plan(request)
        result = worker.apply(request, plan['planHash'], user_confirmed=True)
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(sum(call[1] == TASK_CREATE for call in api.calls), 1)


if __name__ == '__main__':
    unittest.main()
