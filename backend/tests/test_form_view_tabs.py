"""Audience matching and field isolation for published list views."""
from copy import deepcopy
import pytest
from app.services.form_view_tabs import runtime_view_config


def view(name, mode='restricted', roles=None, users=None, orgs=None):
    return {'id': name, 'name': name, 'audience': {'mode': mode, 'roleIds': roles or [], 'userIds': users or [], 'orgIds': orgs or []},
            'filters': [{'fieldName': 'public'}, {'fieldName': 'secret'}],
            'table': {'columns': [{'fieldName': 'public'}, {'fieldName': 'secret'}], 'defaultSort': {'fieldName': 'secret'}}}


def scoped(config, **kwargs):
    return runtime_view_config(config, user_id=8, role_ids=[2], org_ids=[3], **kwargs)


@pytest.mark.parametrize('binding', [{'roles': [2]}, {'users': [8]}, {'orgs': [3]}])
def test_any_matching_binding_allows_view(binding):
    result = scoped({'tabs': [view('mine', **binding)]})
    assert [tab['id'] for tab in result['tabs']] == ['mine']
    assert 'audience' not in result['tabs'][0]


def test_unmatched_views_cannot_leak_through_root_and_do_not_mutate_published_config():
    config = {'filters': [{'fieldName': 'secret'}], 'table': {'columns': [{'fieldName': 'secret'}]}, 'tabs': [view('other', roles=[99])]}
    before = deepcopy(config)
    result = scoped(config)
    assert result['tabs'] == [] and result['filters'] == [] and result['table']['columns'] == []
    assert config == before


def test_public_and_admin_visibility():
    config = {'tabs': [view('public', 'everyone'), view('restricted', users=[99])]}
    assert len(scoped(config)['tabs']) == 1
    assert len(scoped(config, is_admin=True)['tabs']) == 2


def test_unbound_and_unknown_modes_fail_closed():
    assert scoped({'tabs': [view('empty'), view('invalid', 'unexpected')]})['tabs'] == []


def test_field_permission_pruning_in_each_tab_and_compatibility_root():
    result = scoped({'tabs': [view('one', 'everyone'), view('two', users=[8])]}, visible_fields={'public'})
    for tab in [result, *result['tabs']]:
        assert tab['filters'] == [{'fieldName': 'public'}]
        assert tab['table']['columns'] == [{'fieldName': 'public'}]
        assert 'defaultSort' not in tab['table']


def test_legacy_view_without_tabs_is_preserved():
    config = {'filters': [], 'table': {'columns': [{'fieldName': 'public'}]}}
    assert scoped(config) == config


def test_malformed_audience_does_not_expose_a_view():
    broken = view('broken')
    broken['audience'] = 'invalid'
    assert scoped({'tabs': [broken]})['tabs'] == []
    broken['audience'] = {'mode': 'restricted', 'roleIds': '2', 'userIds': None, 'orgIds': []}
    assert scoped({'tabs': [broken]})['tabs'] == []
