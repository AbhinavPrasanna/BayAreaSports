import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bayline_ops', Path(__file__).parents[1] / 'deploy' / 'ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class RecoveryGuards(unittest.TestCase):
    def test_refuses_live_or_arbitrary_restore_targets_before_network_or_database_writes(self):
        with patch.object(ops, 'aws') as aws, patch.object(ops, 'compose') as compose:
            for target in ('bayline', 'postgres', 'bayline_restore_1;DROP DATABASE bayline', '../backup'):
                with self.assertRaises(RuntimeError):
                    ops.restore('postgres/20261021T100000Z-abcdef123456.json', target)
            aws.assert_not_called()
            compose.assert_not_called()

    def test_corrupted_download_never_creates_a_database(self):
        def download(*args):
            destination = Path(args[3])
            if destination.name == 'manifest.json':
                destination.write_text(json.dumps({'key': 'postgres/20261021T100000Z-abcdef123456.dump',
                    'sha256': '0' * 64, 'canary': 'a' * 32}))
            else:
                destination.write_bytes(b'corrupted-dump')
            return ''
        with patch.object(ops, 'config', return_value={'BACKUP_BUCKET': 'test-only'}), \
             patch.object(ops, 'aws', side_effect=download), patch.object(ops, 'compose') as compose:
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                ops.restore('postgres/20261021T100000Z-abcdef123456.json', 'bayline_restore_20261021100000')
            compose.assert_not_called()

    def test_rejects_manifest_keys_outside_the_backup_prefix(self):
        with patch.object(ops, 'aws') as aws:
            with self.assertRaises(RuntimeError):
                ops.restore('other/database.json', 'bayline_restore_20261021100000')
            aws.assert_not_called()


if __name__ == '__main__':
    unittest.main()
