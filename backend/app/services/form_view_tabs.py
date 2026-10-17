"""Runtime view audience selection; record and field authorization remain separate."""
from copy import deepcopy


def runtime_view_config(config, *, user_id, role_ids, org_ids, is_admin=False, visible_fields=None):
    if not isinstance(config, dict):
        return config
    result = deepcopy(config)

    def prune(view):
        if visible_fields is not None:
            view['filters'] = [item for item in view.get('filters', []) if isinstance(item, dict) and item.get('fieldName') in visible_fields]
            table = view.get('table') if isinstance(view.get('table'), dict) else {}
            table['columns'] = [item for item in table.get('columns', []) if isinstance(item, dict) and item.get('fieldName') in visible_fields]
            if (table.get('defaultSort') or {}).get('fieldName') not in visible_fields:
                table.pop('defaultSort', None)
            view['table'] = table
        return view

    if not isinstance(result.get('tabs'), list):
        return prune(result)
    def audience_ids(audience, key):
        values = audience.get(key)
        return {value for value in values if type(value) is int and value > 0} if isinstance(values, list) else set()

    tabs = []
    for tab in result['tabs']:
        if not isinstance(tab, dict) or not tab.get('id'):
            continue
        audience = tab.get('audience') if isinstance(tab.get('audience'), dict) else {}
        # Missing/unknown audience modes must never widen access.
        permitted = is_admin or audience.get('mode') == 'everyone'
        if audience.get('mode') == 'restricted':
            permitted = permitted or (
                user_id in audience_ids(audience, 'userIds')
                or bool(set(role_ids) & audience_ids(audience, 'roleIds'))
                or bool(set(org_ids) & audience_ids(audience, 'orgIds'))
            )
        if permitted:
            tab.pop('audience', None)
            tabs.append(prune(tab))
    result['tabs'] = tabs
    # Root compatibility must never retain a view the current user cannot see.
    result['filters'] = tabs[0].get('filters', []) if tabs else []
    result['table'] = tabs[0].get('table', {'columns': []}) if tabs else {'columns': []}
    return result
