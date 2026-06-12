"""Form engine: storage-agnostic core extracted from app.api.forms.

Layering (imports only point downward):

    naming.py      table/column naming + tenant namespace rules   (pure)
    validation.py  record/status/field-value validation            (pure)
    encoding.py    auto-encoding (料号) rule helpers               (pure)
    query.py       search/filter/sort helpers for record queries
    physical.py    physical-table DDL, queries, impact analysis
    sequences.py   atomic code sequence allocation + uniqueness

app.api.forms re-imports these names so existing call sites and tests
(`from app.api.forms import _validate_record_data`, ...) keep working.
"""

from app.api.form_engine.naming import (
    ANALYTICS_FORM_KINDS,
    PHYSICAL_FORM_STORAGE_MODES,
    _is_analysis_form_config,
    _physical_column_name,
    _physical_table_name_for_form,
    _uses_physical_form_table,
    _validate_physical_table_name,
)
from app.api.form_engine.validation import (
    ALLOWED_RECORD_STATUSES,
    _field_allowed_values,
    _field_value_is_compatible,
    _merged_record_data,
    _validate_record_data,
    _validate_record_status,
)
from app.api.form_engine.encoding import (
    _code_sequence_from_value,
    _date_token_for_rule,
    _encoding_rule_for_field,
    _is_encoding_field,
    _render_code_template,
    _rule_code_embeds_date,
    _sequence_period_key,
)
from app.api.form_engine.query import (
    _apply_record_filters_query,
    _apply_record_search_query,
    _apply_record_sort_query,
    _ensure_filter_fields_visible,
    _ensure_production_record_query_supported,
    _ensure_sort_field_allowed,
    _is_anonymous_reader,
    _json_text_expr,
    _parse_record_filters,
    _queryable_field_names,
    _record_matches_filters,
    _record_matches_search,
    _runtime_visible_field_names,
    _sortable_field_names,
    _visible_field_subset,
)
from app.api.form_engine.physical import (
    _coerce_physical_value,
    _dynamic_record_field_impact,
    _ensure_physical_code_indexes,
    _ensure_physical_form_table,
    _get_physical_record,
    _isoformat_value,
    _list_physical_records,
    _normalize_sql_type,
    _physical_column_type,
    _physical_filter_clause,
    _physical_record_field_impact,
    _physical_record_payload,
    _physical_table_column_types,
    _physical_table_columns,
    _physical_write_payload,
    _sql_current_timestamp,
)
from app.api.form_engine.sequences import (
    _CODE_ALLOCATION_MAX_ATTEMPTS,
    _allocate_code_sequence,
    _apply_record_encoding_rules,
    _assert_unique_code_values,
    _code_value_exists,
    _max_dynamic_code_sequence,
    _max_physical_code_sequence,
)

__all__ = [
    "ANALYTICS_FORM_KINDS",
    "PHYSICAL_FORM_STORAGE_MODES",
    "ALLOWED_RECORD_STATUSES",
    "_CODE_ALLOCATION_MAX_ATTEMPTS",
    "_allocate_code_sequence",
    "_apply_record_encoding_rules",
    "_apply_record_filters_query",
    "_apply_record_search_query",
    "_apply_record_sort_query",
    "_assert_unique_code_values",
    "_code_sequence_from_value",
    "_code_value_exists",
    "_coerce_physical_value",
    "_date_token_for_rule",
    "_dynamic_record_field_impact",
    "_encoding_rule_for_field",
    "_ensure_filter_fields_visible",
    "_ensure_physical_code_indexes",
    "_ensure_physical_form_table",
    "_ensure_production_record_query_supported",
    "_ensure_sort_field_allowed",
    "_field_allowed_values",
    "_field_value_is_compatible",
    "_get_physical_record",
    "_is_analysis_form_config",
    "_is_anonymous_reader",
    "_is_encoding_field",
    "_isoformat_value",
    "_json_text_expr",
    "_list_physical_records",
    "_max_dynamic_code_sequence",
    "_max_physical_code_sequence",
    "_merged_record_data",
    "_normalize_sql_type",
    "_parse_record_filters",
    "_physical_column_name",
    "_physical_column_type",
    "_physical_filter_clause",
    "_physical_record_field_impact",
    "_physical_record_payload",
    "_physical_table_column_types",
    "_physical_table_columns",
    "_physical_table_name_for_form",
    "_physical_write_payload",
    "_queryable_field_names",
    "_record_matches_filters",
    "_record_matches_search",
    "_render_code_template",
    "_rule_code_embeds_date",
    "_runtime_visible_field_names",
    "_sequence_period_key",
    "_sortable_field_names",
    "_sql_current_timestamp",
    "_uses_physical_form_table",
    "_validate_physical_table_name",
    "_validate_record_data",
    "_validate_record_status",
    "_visible_field_subset",
]
