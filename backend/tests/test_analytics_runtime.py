import pytest
from app.services.analytics_runtime import AnalyticsError, build_data, calculate, design_errors

ROWS = [
    {'subject': 'A', 'category': '组装', 'date': '2026-10-01', 'actual': 30, 'target': 60, 'status': '已关闭'},
    {'subject': 'A', 'category': '组装', 'date': '2026-10-02', 'actual': 50, 'target': 40, 'status': '待处理'},
    {'subject': 'B', 'category': '包装', 'date': '2026-10-02', 'actual': 20, 'target': 100, 'status': '已关闭'},
]
FIELDS = set(ROWS[0])

def design():
    return {'datasets': [{'id': 'd', 'name': '来源', 'sourceType': 'businessForm', 'source': 'source-form', 'refreshMode': 'manual', 'dimensions': ['subject', 'category', 'date', 'status'], 'measures': ['actual', 'target']}],
            'metrics': [{'id': 'metric-total', 'name': '目标总计', 'datasetId': 'd', 'expression': 'sum(target)', 'format': 'number'}, {'id': 'rate', 'name': '达成率', 'datasetId': 'd', 'expression': 'sum(actual) / sum(target)', 'format': 'percent'}],
            'widgets': [{'id': 'chart', 'title': '分组', 'datasetId': 'd', 'type': 'bar', 'dimension': 'subject', 'metricIds': ['metric-total', 'rate']}, {'id': 'rank', 'title': '排行', 'datasetId': 'd', 'type': 'rank-table', 'dimension': 'subject', 'metricIds': ['rate']}],
            'globalFilters': ['category', 'dateRange'], 'interactions': []}

@pytest.mark.parametrize('expression,expected', [
    ('count(*)', 3), ('count(subject)', 3), ('count_distinct(subject)', 2),
    ('sum(target)', 200), ('sum(actual)', 100), ('avg(actual)', 100 / 3),
    ('min(actual)', 20), ('max(actual)', 50), ('actual / target', .5),
    ('count_if(status == "已关闭")', 2), ('count_if(actual >= 30 and target > 0)', 2),
])
def test_expressions_use_named_fields(expression, expected):
    assert calculate(expression, ROWS, FIELDS) == pytest.approx(expected, abs=.0001)

@pytest.mark.parametrize('expression', ['__import__("os")', 'actual.__class__', 'sum(secret)', 'sum(actual, target)', 'sum(sum(actual))', 'actual ** 1000000', '[actual]', 'count_if(x for x in actual)'])
def test_rejects_unknown_fields_and_executable_syntax(expression):
    with pytest.raises(AnalyticsError): calculate(expression, ROWS, FIELDS)

def test_empty_null_and_division_by_zero_are_not_fabricated():
    assert calculate('sum(actual) / sum(target)', [], FIELDS, 'percent') is None
    assert calculate('count(*)', [], FIELDS) == 0
    assert calculate('avg(actual)', [{'actual': None}], FIELDS) is None
    with pytest.raises(AnalyticsError): calculate('sum(actual)', [{'actual': 'bad'}], FIELDS)

def test_fixed_metric_id_does_not_override_expression_and_grouped_rates_are_weighted():
    data = build_data(design(), {'d': ROWS}, {'d': FIELDS})
    assert data['metricValues']['metric-total'] == 200
    assert data['metricValues']['rate'] == 50
    assert data['widgets']['chart']['series'] == [{'name': 'A', 'metric-total': 100, 'rate': 80}, {'name': 'B', 'metric-total': 100, 'rate': 20}]
    assert [row['name'] for row in data['widgets']['rank']['series']] == ['A', 'B']

def test_global_filter_link_target_and_dataset_are_isolated():
    configuration = design()
    configuration['datasets'].append({**configuration['datasets'][0], 'id': 'other'})
    configuration['metrics'].append({'id': 'other-total', 'name': '另一数据集', 'datasetId': 'other', 'expression': 'sum(actual)'})
    data = build_data(configuration, {'d': ROWS, 'other': [{**ROWS[0], 'actual': 999}]}, {'d': FIELDS, 'other': FIELDS}, {'dateRange': ['2026-10-02', '2026-10-02']}, {'rank': {'subject': 'B'}})
    assert data['metricValues']['metric-total'] == 140
    assert data['metricValues']['other-total'] == 0
    assert data['widgets']['chart']['total'] == 2
    assert data['widgets']['rank']['total'] == 1
    assert data['filterOptions']['category'] == ['包装', '组装']

def test_invalid_source_has_no_fake_zero_and_limit_does_not_change_totals():
    assert build_data(design(), {}, {})['widgets']['chart']['metricValues']['rate'] is None
    data = build_data(design(), {'d': ROWS}, {'d': FIELDS}, limit=1)
    assert data['metricValues']['metric-total'] == 200
    assert data['widgets']['chart']['total'] == 3
    assert data['widgets']['chart']['truncated']
    assert len(data['widgets']['chart']['rows']) == 1

def test_configuration_errors_block_bad_references_and_unsupported_sources():
    configuration = design()
    assert design_errors(configuration) == []
    configuration['datasets'][0]['sourceType'] = 'sql'
    configuration['metrics'][0]['expression'] = 'sum(missing)'
    configuration['widgets'][0]['metricIds'] = ['missing']
    configuration['interactions'] = [{'sourceWidgetId': 'chart', 'targetWidgetId': 'chart'}]
    assert len(design_errors(configuration)) >= 4

@pytest.mark.parametrize('fields', [[], [{'field_name': 'qty', 'field_type': 'integer'}]])
def test_generated_boards_only_reference_real_fields(fields):
    from app.services.ai.low_code_tools import _standard_analytics_design
    configuration = _standard_analytics_design('test', '测试', fields)
    assert design_errors(configuration) == []
    declared = set(configuration['datasets'][0]['dimensions'] + configuration['datasets'][0]['measures'])
    assert declared <= {field['field_name'] for field in fields}
