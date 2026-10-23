import pytest
from app.services.analytics_dataset_range import filter_dataset_range
from app.services.analytics_editor import AnalyticsDesignRequest
from app.services.analytics_runtime import build_data, design_errors

ROWS = [{'status':'正常','actual':10,'date':'2026-10-01','note':None},
        {'status':'预警','actual':100,'date':'2026-10-02','note':'ABC'},
        {'status':'正常','actual':30,'date':'2026-10-03','note':'abc'}]
FIELDS = set(ROWS[0])

def config(conditions):
    return {'datasets':[{'id':'d','name':'范围测试','sourceType':'businessForm','source':'production','refreshMode':'manual',
        'dimensions':['status','date','note'],'measures':['actual'],'rangeFilters':conditions}],
        'metrics':[{'id':'sum','name':'产量','datasetId':'d','expression':'sum(actual)'}],
        'widgets':[{'id':'w','title':'明细','type':'detail-table','datasetId':'d','metricIds':['sum']}], 'globalFilters':['status']}

def test_scope_is_applied_before_metrics_widget_filters_options_and_preview_limit():
    conditions = [{'field':'status','operator':'eq','value':'正常'},{'field':'actual','operator':'gte','value':'20'}]
    result = build_data(config(conditions),{'d':ROWS},{'d':FIELDS},limit=1)
    assert result['metricValues']['sum'] == 30
    assert result['widgets']['w']['total'] == 1
    assert result['widgets']['w']['rows'] == [ROWS[2]]
    assert result['filterOptions']['status'] == ['正常']
    result = build_data(config(conditions),{'d':ROWS},{'d':FIELDS},widget_filters={'w':{'status':'预警'}})
    assert result['widgets']['w']['total'] == 0
    assert result['metricValues']['sum'] == 30

@pytest.mark.parametrize('condition,indexes', [
    ({'field':'actual','operator':'gt','value':'10'},[1,2]),
    ({'field':'actual','operator':'eq','value':'10.0'},[0]),
    ({'field':'actual','operator':'lte','value':'30'},[0,2]),
    ({'field':'status','operator':'ne','value':'正常'},[1]),
    ({'field':'date','operator':'gte','value':'2026-10-02'},[1,2]),
    ({'field':'note','operator':'contains','value':'aB'},[1,2]),
    ({'field':'note','operator':'isEmpty'},[0]),
    ({'field':'note','operator':'notEmpty'},[1,2]),
])
def test_supported_operators(condition,indexes):
    assert filter_dataset_range(ROWS,[condition],FIELDS) == [ROWS[i] for i in indexes]

def test_invisible_scope_field_fails_closed():
    result = build_data(config([{'field':'actual','operator':'gte','value':'20'}]),{'d':[{'status':'正常'}]},{'d':{'status'}})
    assert result['widgets']['w']['total'] == 0
    assert any('不可见' in error for error in result['errors'])

@pytest.mark.parametrize('conditions', [None, {}, [None], [{'field':'status','operator':'execute','value':'x'}],
    [{'field':'status','operator':'eq','value':''}], [{'field':'status','operator':'eq','value':{}}],
    [{'field':'status','operator':'eq','value':'x'}]*21])
def test_invalid_conditions_rejected_before_draft_or_preview(conditions):
    with pytest.raises(ValueError): AnalyticsDesignRequest(design=config(conditions))

def test_removed_field_blocks_publish_and_nonfinite_comparisons_never_match():
    assert any('范围字段' in message for message in design_errors(config([{'field':'missing','operator':'eq','value':'x'}])))
    assert filter_dataset_range(ROWS,[{'field':'actual','operator':'gt','value':'NaN'}],FIELDS) == []
