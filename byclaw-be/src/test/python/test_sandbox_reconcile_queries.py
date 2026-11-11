"""Execute the checked-in mapper's recovery predicates against an in-memory SQLite fixture.

No application database or service is used. This verifies selection semantics, not
openGauss's execution plan or JDBC behavior.
"""
import pathlib
import re
import sqlite3
import unittest
import xml.etree.ElementTree as ET

MAPPER = pathlib.Path(__file__).resolve().parents[2] / 'main/resources/com/iwhalecloud/byai/manager/mapper/sandbox/SsSandboxRecordMapper.xml'
ROOT = ET.parse(MAPPER).getroot()
NODES = {node.attrib['id']: node for node in ROOT if 'id' in node.attrib}


def render(name, **params):
    def expand(node):
        text = node.text or ''
        for child in node:
            if child.tag == 'include':
                text += expand(NODES[child.attrib['refid']])
            elif child.tag == 'if':
                test = child.attrib['test']
                field = re.match(r'\w+', test).group()
                if params.get(field):
                    text += expand(child)
            elif child.tag == 'foreach':
                resources = params.get(child.attrib['collection'], [])
                text += '(' + ','.join(str(int(value)) for value in resources) + ')'
            text += child.tail or ''
        return text
    args = []
    def bind(match):
        args.append(params.get(match.group(1)))
        return '?'
    sql = re.sub(r'#\{(\w+)[^}]*\}', bind, expand(NODES[name]))
    return sql.replace('FOR UPDATE', ''), args


class RecoveryQueriesTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        columns = re.findall(r'\b\w+\b', NODES['Base_Column_List'].text)
        self.db.execute('CREATE TABLE ss_sandbox_record (' + ','.join(columns) + ')')

    def tearDown(self):
        self.db.close()

    def row(self, identity, status, sandbox=None, reason=None, user='u', resource=-1, owner='USER'):
        self.db.execute('INSERT INTO ss_sandbox_record '
                        '(id,user_code,sandbox_type,resource_id,status,sandbox_id,release_reason,owner_scope,update_time,version,lock_version) '
                        'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                        (identity, user, 'openclaw', resource, status, sandbox, reason, owner, identity, 0, 0))

    def execute(self, query, **kwargs):
        sql, args = render(query, **kwargs)
        return self.db.execute(sql, args).fetchall()

    def test_count_groups_and_rows_include_both_durable_recovery_states(self):
        self.row(1, 'STARTING')
        self.row(2, 'RELEASED', 'old', 'release.remote.missing', user='pending')
        self.row(3, 'RUNNING', 'active', user='running')
        self.row(4, 'RELEASED', 'stopped', 'release.manual', user='manual')
        self.row(5, 'STARTING', user='tenant', owner='TENANT')
        self.assertEqual(self.execute('countReconcileSandboxes')[0][0], 3)
        self.assertEqual(len(self.execute('selectReconcileGroups', limit=10)), 3)
        for user in ('u', 'pending', 'running'):
            self.assertEqual(len(self.execute('selectReconcileSandboxesByGroup', userCode=user,
                                              sandboxType='openclaw', limit=10)), 1)

    def test_any_newer_attempt_even_manual_terminal_suppresses_old_restart(self):
        self.row(1, 'RELEASED', 'old', 'release.remote.missing')
        self.assertEqual(len(self.execute('selectPendingReconcileRestart', id=1)), 1)
        self.row(2, 'RELEASED', 'new', 'release.manual')
        self.assertEqual(self.execute('selectPendingReconcileRestart', id=1), [])
        self.assertEqual(self.execute('countReconcileSandboxes')[0][0], 0)

    def test_different_resources_and_tenants_do_not_supersede_restart(self):
        self.row(1, 'RELEASED', 'old', 'release.remote.missing')
        self.row(2, 'RUNNING', 'other-resource', resource=7)
        self.row(3, 'RUNNING', 'tenant', owner='TENANT')
        self.assertEqual(len(self.execute('selectPendingReconcileRestart', id=1)), 1)

    def test_manual_cancellation_prevents_future_replay_and_is_scoped(self):
        self.row(1, 'RELEASED', 'old', 'release.remote.missing')
        self.row(2, 'RELEASED', 'other', 'release.remote.missing', user='other')
        self.execute('cancelPendingReconcileRestarts', userCode='u', sandboxType='openclaw',
                     resourceIds=[-1], reason='release.manual:u', now=20)
        self.assertEqual(self.execute('selectPendingReconcileRestart', id=1), [])
        self.assertEqual(len(self.execute('selectPendingReconcileRestart', id=2)), 1)


if __name__ == '__main__':
    unittest.main()
