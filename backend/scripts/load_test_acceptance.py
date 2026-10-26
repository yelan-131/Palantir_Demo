"""Bounded HTTP load test of dedicated UAT data in the existing local service.

No schema/role/permission changes, no login flood, no production record writes.
Closed-loop concurrent clients are not equivalent to a count of human users.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import statistics
import time
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[3]
UAT = ROOT / 'outputs/business-acceptance-20261026.json'


def percentile(values, q):
    if not values: return None
    values = sorted(values)
    position = (len(values) - 1) * q
    lo, hi = math.floor(position), math.ceil(position)
    return round(values[lo] + (values[hi] - values[lo]) * (position - lo), 2)


def summarize(samples, elapsed):
    latency = [sample['ms'] for sample in samples]
    errors = [sample for sample in samples if not sample['ok']]
    return {'requests': len(samples), 'elapsed_s': round(elapsed, 3),
            'completed_rps': round(len(samples) / elapsed, 2) if elapsed else 0,
            'expected_result_rps': round((len(samples) - len(errors)) / elapsed, 2) if elapsed else 0,
            'unexpected_errors': len(errors), 'unexpected_error_pct': round(100 * len(errors) / len(samples), 2) if samples else 0,
            'status_counts': dict(Counter(str(sample['status']) for sample in samples)),
            'mean_ms': round(statistics.mean(latency), 2) if latency else None,
            'p50_ms': percentile(latency, .50), 'p95_ms': percentile(latency, .95),
            'p99_ms': percentile(latency, .99), 'max_ms': round(max(latency), 2) if latency else None}


async def main(args):
    uat = json.loads(UAT.read_text())
    credentials = json.loads(Path('/private/tmp/manufoundry-uat-20261026-credentials.json').read_text())
    base = uat['environment']
    if base not in {'http://127.0.0.1:13000/api/v1', 'http://localhost:13000/api/v1'}:
        raise RuntimeError('Only the authorized local 13000 UAT environment is supported')
    ids = {key.rsplit('_', 1)[1]: value for key, value in uat['entities']['users'].items()}
    orgs = uat['entities']['orgs']
    fid = uat['entities']['forms']['uat-complex-20261026']
    source = uat['entities']['forms']['uat-request-20261026']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run_id = stamp + '-' + uuid4().hex[:6]
    output = ROOT / 'outputs' / f'load-test-{run_id}.json'
    raw_path = output.with_suffix('.jsonl')
    report = {'run_id': run_id, 'started_at': datetime.now(timezone.utc).isoformat(),
              'environment': base, 'configuration': {'backend': 'single uvicorn process with reload',
              'database_pool_size': 5, 'database_max_overflow': 5, 'postgres_max_connections': 100,
              'model': 'closed-loop, zero think time; HTTP API latency including local Vite proxy',
              'request_timeout_s': args.timeout, 'latency_target_ms': 2000,
              'stop_p95_ms': args.stop_p95, 'stop_error_pct': 5,
              'read_duration_s': args.seconds, 'write_duration_s': args.write_seconds,
              'read_concurrency_levels': args.read_levels, 'write_concurrency_levels': args.write_levels,
              'login': 'one real login per account before measurement; login not load-tested'},
              'stages': [], 'records': [], 'checks': [], 'resource_samples': [],
              'limitations': ['Local development configuration and current small UAT dataset only; not a production capacity claim',
                              'Closed-loop load does not measure open-loop arrival-rate overload or human browser rendering',
                              'Short load runs do not establish long-term stability',
                              'Expected authorization 403 and contention 409 are checked separately from unexpected errors'],
              'raw_samples': str(raw_path)}
    clients = {}
    stop_all = False

    def save():
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

    def check(name, actual, expected):
        ok = actual == expected
        report['checks'].append({'name': name, 'actual': actual, 'expected': expected, 'passed': ok})
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        save()
        return ok

    async def call(who, method, path, payload=None):
        response = await clients[who].request(method, path, json=payload)
        response.raise_for_status()
        value = response.json()
        return value.get('data', value)

    async def resources(label):
        process = await asyncio.create_subprocess_exec('docker', 'stats', '--no-stream', '--format', '{{json .}}',
            'palantir-mac-backend-1', 'palantir-mac-postgres-1', stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await process.communicate()
        for line in stdout.decode().splitlines():
            row = json.loads(line)
            report['resource_samples'].append({'at': datetime.now(timezone.utc).isoformat(), 'stage': label,
                'name': row['Name'], 'cpu_pct': float(row['CPUPerc'].rstrip('%')),
                'memory': row['MemUsage'], 'memory_pct': float(row['MemPerc'].rstrip('%')), 'pids': row['PIDs']})
        save()

    def valid_read(who, name, payload):
        data = payload.get('data', payload)
        if name == 'records':
            if who in {'a', 'b', 'c'} and any(row.get('created_by') != ids[who] for row in data):
                return 'owner scope violation'
            if who == 'f' and any('secret' in row.get('data', {}) or row.get('data', {}).get('org_unit_id') != orgs['uat_20261026_dept_a'] for row in data):
                return 'observer scope or hidden-field violation'
        if name == 'inbox' and who == 'f':
            if any(field['field_name'] == 'secret' for item in data.get('items', []) for field in item.get('fields', [])):
                return 'workflow hidden-field violation'
        return None

    async def measured(who, method, path, name, *, expected=200, payload=None, verify=None):
        started = time.perf_counter()
        error, status, size = None, 'exception', 0
        try:
            response = await clients[who].request(method, path, json=payload)
            status, size = response.status_code, len(response.content)
            if status != expected:
                error = f'expected HTTP {expected}'
            elif expected == 200:
                body = response.json()
                error = verify(body) if verify else valid_read(who, name, body)
        except Exception as exc:
            # Do not serialize requests, cookies, credentials or response data.
            error = type(exc).__name__
        return {'at': datetime.now(timezone.utc).isoformat(), 'operation': name, 'account': who,
                'status': status, 'expected_status': expected, 'ok': error is None,
                'error': error, 'ms': round(1000 * (time.perf_counter() - started), 3), 'bytes': size}

    async def stage(profile, concurrency, duration, operation):
        nonlocal stop_all
        samples = []
        abort = asyncio.Event()
        started = time.perf_counter()
        deadline = started + duration
        stage_name = f'{profile}:{concurrency}'
        report['active_stage'] = stage_name
        save()
        async def worker(index):
            sequence = 0
            while time.perf_counter() < deadline and not abort.is_set():
                result = await operation(index, sequence)
                sequence += 1
                samples.append(result)
                with raw_path.open('a') as handle:
                    handle.write(json.dumps({'stage': stage_name, **result}, ensure_ascii=False) + '\n')
                errors = sum(not sample['ok'] for sample in samples[-100:])
                if result['error'] and 'violation' in result['error']:
                    abort.set(); stop_all = True
                if len(samples) >= 20 and errors / min(len(samples), 100) > .05:
                    abort.set()
        # Keep telemetry off the API pool. Docker CLI sampling is outside request timing.
        async def monitor():
            await resources(stage_name)
            while time.perf_counter() < deadline and not abort.is_set():
                await asyncio.sleep(4)
                if time.perf_counter() < deadline:
                    await resources(stage_name)
        monitoring = asyncio.create_task(monitor())
        await asyncio.gather(*(worker(i) for i in range(concurrency)))
        elapsed = time.perf_counter() - started
        monitoring.cancel()
        try: await monitoring
        except asyncio.CancelledError: pass
        result = {'profile': profile, 'concurrency': concurrency, 'scheduled_duration_s': duration,
                  **summarize(samples, elapsed), 'operations': {}}
        grouped = defaultdict(list)
        for sample in samples: grouped[sample['operation']].append(sample)
        result['operations'] = {name: summarize(rows, elapsed) for name, rows in grouped.items()}
        result['stop_increasing'] = abort.is_set() or result['unexpected_error_pct'] > 5 or (result['p95_ms'] or 0) > args.stop_p95
        report['stages'].append(result)
        report.pop('active_stage', None)
        save()
        print(json.dumps({'stage': stage_name, **{k: result[k] for k in ['requests', 'completed_rps', 'p95_ms', 'unexpected_errors', 'status_counts', 'stop_increasing']}}, ensure_ascii=False), flush=True)
        return result

    async def draft(owner, label):
        body = {'title': f'【压测】{run_id}-{label}', 'applicant_id': str(ids[owner]),
                'org_unit_id': orgs['uat_20261026_dept_b' if owner == 'c' else 'uat_20261026_dept_a'],
                'request_type': 'data_access', 'priority': 'normal', 'data_categories': ['production'],
                'requested_scope': 'department', 'estimated_rows': 10, 'contains_sensitive': False,
                'expected_date': (date.today() + timedelta(days=5)).isoformat(),
                'purpose': f'【压测】{run_id}-initial', 'secret': '虚构压测内部备注'}
        row = await call(owner, 'POST', f'/forms/{fid}/records', {'data': body})
        record = {'form_id': fid, 'record_id': row['id'], 'owner': owner, 'label': label, 'purpose': body['purpose']}
        report['records'].append(record); save()
        return record

    try:
        for who in ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'admin']:
            clients[who] = httpx.AsyncClient(base_url=base, trust_env=False, timeout=args.timeout,
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=50))
            await call(who, 'POST', '/auth/login', {'username': 'admin' if who == 'admin' else credentials['users'][who],
                'password': os.environ['UAT_ADMIN_PASSWORD'] if who == 'admin' else credentials['password']})
        async with httpx.AsyncClient(trust_env=False, timeout=5) as health:
            before = await health.get('http://127.0.0.1:18000/health')
            check('Backend healthy before load', before.status_code, 200)
        await resources('baseline')
        a_record = uat['entities']['records']['a']['record_id']
        plan = [('a', 'records', f'/forms/{source}/records?page_size=20', 200),
                ('b', 'records', f'/forms/{source}/records?page_size=20', 200),
                ('c', 'records', f'/forms/{source}/records?page_size=20', 200),
                ('f', 'records', f'/forms/{source}/records?page_size=20', 200),
                ('a', 'detail', f'/forms/{source}/records/{a_record}', 200),
                ('d', 'detail', f'/forms/{source}/records/{a_record}', 200),
                ('d', 'inbox', '/workflow/business-items', 200),
                ('e', 'inbox', '/workflow/business-items', 200),
                ('f', 'inbox', '/workflow/business-items', 200),
                ('g', 'denied_form', f'/forms/{source}', 403),
                ('a', 'applications', '/applications', 200),
                ('e', 'notification_count', '/notifications/unread-count', 200)]
        async def read_operation(index, sequence):
            who, name, path, expected = plan[(index + sequence) % len(plan)]
            return await measured(who, 'GET', path, name, expected=expected)
        # One warmup request per operation is excluded from latency statistics.
        for index in range(len(plan)):
            sample = await read_operation(index, 0)
            if not sample['ok']: raise RuntimeError(f'Warmup failed: {sample["operation"]}: {sample["status"]}: {sample["error"]}')
        for concurrency in args.read_levels:
            result = await stage('mixed_read', concurrency, args.seconds, read_operation)
            if result['stop_increasing']:
                print('Read ramp stopped at guardrail', flush=True); break
            await asyncio.sleep(2)

        if not stop_all:
            if args.reuse_records:
                previous = json.loads(Path(args.reuse_records).read_text())
                assert previous['environment'] == base
                slots = [dict(row) for row in previous['records'] if row['label'].startswith('worker-')][:args.max_write]
                assert len(slots) == args.max_write and all(slot['form_id'] == fid for slot in slots)
                for slot in slots:
                    row = await call(slot['owner'], 'GET', f'/forms/{fid}/records/{slot["record_id"]}')
                    assert row['status'] == 'draft' and row['data']['title'].startswith('【压测】')
                    slot['purpose'] = row['data']['purpose']
                report['records'].extend(slots)
                report['configuration']['reuse_records'] = str(args.reuse_records)
                save()
            else:
                slots = [await draft(['a', 'b', 'c'][i % 3], f'worker-{i}') for i in range(args.max_write)]
            async def write_operation(index, sequence):
                slot = slots[index]
                value = f'【压测】{run_id}-worker{index}-seq{sequence}-{uuid4().hex[:6]}'
                body = {'data': {'purpose': value}, 'expected_values': {'purpose': slot['purpose']}}
                def verify(payload):
                    data = payload.get('data', payload)
                    return None if data['data'].get('purpose') == value and data['status'] == 'draft' else 'saved value violation'
                result = await measured(slot['owner'], 'PUT', f'/forms/{fid}/records/{slot["record_id"]}', 'draft_save', payload=body, verify=verify)
                if result['ok']: slot['purpose'] = value
                return result
            for concurrency in [n for n in args.write_levels if n <= args.max_write]:
                result = await stage('draft_save', concurrency, args.write_seconds, write_operation)
                if result['stop_increasing']:
                    print('Write ramp stopped at guardrail', flush=True); break
                await asyncio.sleep(2)
            for slot in slots:
                row = await call(slot['owner'], 'GET', f'/forms/{fid}/records/{slot["record_id"]}')
                check(f'Draft worker {slot["record_id"]} last acknowledged value persisted', row['data'].get('purpose'), slot['purpose'])

            if not args.skip_contention:
                race = await draft('a', 'submit-and-approval-contention')
                path = f'/forms/{fid}/records/{race["record_id"]}'
                started = time.perf_counter()
                responses = await asyncio.gather(*(clients['a'].post(path + '/submit', json={'expected_status': 'draft'}) for _ in range(20)))
                counts = Counter(r.status_code for r in responses)
                check('Twenty concurrent submits: one accepted and nineteen conflicts', dict(counts), {200: 1, 409: 19})
                report['submit_contention'] = {'requests': 20, 'elapsed_s': round(time.perf_counter() - started, 3), 'status_counts': dict(counts)}
                success = next((r for r in responses if r.status_code == 200), None)
                if success:
                    iid = success.json()['data']['_approval']['workflow_id']; race['workflow_id'] = iid
                    instance = await call('admin', 'GET', f'/workflow/instances/{iid}')
                    node = instance['workflow_state']['current_node']
                    body = {'comment': f'【压测】{run_id}首节点并发处理', 'expected_node_id': node}
                    started = time.perf_counter()
                    responses = await asyncio.gather(*(clients['d'].post(f'/workflow/instances/{iid}/approve', json=body) for _ in range(20)))
                    counts = Counter(r.status_code for r in responses)
                    check('Twenty duplicate approvals cannot advance the next node', dict(counts), {200: 1, 409: 19})
                    report['approval_contention'] = {'requests': 20, 'elapsed_s': round(time.perf_counter() - started, 3), 'status_counts': dict(counts)}
                    instance = await call('admin', 'GET', f'/workflow/instances/{iid}')
                    check('Next D node is still pending after burst', instance['status'], 'pending')
                    await call('d', 'POST', f'/workflow/instances/{iid}/approve', {'comment': f'【压测】{run_id}终审',
                        'expected_node_id': instance['workflow_state']['current_node']})
                    row = await call('a', 'GET', path)
                    check('Source record completes approved after explicit final approval', row['status'], 'approved')
                    check('Submission audit contains exactly one workflow start', sum(h['action'] == 'submit' for h in row['_approval']['history']), 1)
                    final = await call('admin', 'GET', f'/workflow/instances/{iid}')
                    check('Approval audit contains exactly two distinct node actions', sum(h['action'] == 'approve' for h in final['approvals']), 2)
                    instances = await call('admin', 'GET', f'/workflow/instances?workflow_id={final["workflow_id"]}')
                    check('Exactly one stored workflow instance exists for the contested record',
                          sum((item.get('variables') or {}).get('form_id') == fid and (item.get('variables') or {}).get('record_id') == race['record_id'] for item in instances), 1)
        await asyncio.sleep(2)
        await resources('recovery')
        recovery = [await read_operation(i, 0) for i in range(len(plan))]
        report['recovery'] = summarize(recovery, sum(s['ms'] for s in recovery) / 1000)
        check('All twelve low-load recovery probes have expected results', sum(s['ok'] for s in recovery), 12)
        async with httpx.AsyncClient(trust_env=False, timeout=5) as health:
            response = await health.get('http://127.0.0.1:18000/health')
            check('Backend healthy after load', response.status_code, 200)
    except Exception as exc:
        report['aborted'] = type(exc).__name__ + ': ' + str(exc)[:250]
        print('ABORT ' + report['aborted'], flush=True)
    finally:
        report.pop('active_stage', None)
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['check_summary'] = {'passed': sum(c['passed'] for c in report['checks']), 'failed': sum(not c['passed'] for c in report['checks'])}
        save()
        for client in clients.values(): await client.aclose()
        print('REPORT ' + str(output), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=float, default=12)
    parser.add_argument('--write-seconds', type=float, default=10)
    parser.add_argument('--max-write', type=int, choices=[1, 5, 10, 20], default=20)
    parser.add_argument('--timeout', type=float, default=12)
    parser.add_argument('--stop-p95', type=float, default=8000)
    parser.add_argument('--reuse-records', type=str)
    parser.add_argument('--skip-contention', action='store_true')
    parser.add_argument('--read-levels', type=int, nargs='+', choices=[1, 5, 10, 20, 40, 80, 100], default=[1, 5, 10, 20, 40])
    parser.add_argument('--write-levels', type=int, nargs='+', choices=[1, 5, 10, 20], default=[1, 5, 10, 20])
    asyncio.run(main(parser.parse_args()))
