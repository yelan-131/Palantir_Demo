export interface DefaultValuePart { id: string; kind: 'text' | 'field'; value: string }
export interface DefaultValueCondition { sourceField: string; operator: 'eq' | 'ne' | 'contains' | 'gte' | 'lte' | 'isEmpty' | 'notEmpty'; value?: string }
export interface DefaultValueRule { mode: 'fixed' | 'template'; enabled?: boolean; parts?: DefaultValuePart[]; conditions?: DefaultValueCondition[] }
export function newDefaultPart(kind: DefaultValuePart['kind']): DefaultValuePart {
  return { id: crypto.randomUUID(), kind, value: '' };
}
export function defaultRuleSummary(rule: DefaultValueRule, fields: {key: string; name: string}[]) {
  return (rule.parts || []).map(part => part.kind === 'field' ? `「${fields.find(field => field.key === part.value)?.name || '选择字段'}」` : part.value ? JSON.stringify(part.value) : '固定文字').join(' + ');
}

export function defaultRuleErrors(controls: {fieldKey?: string; defaultRule?: DefaultValueRule}[], fields: {key: string; storageType?: string; computed?: boolean; defaultRule?: DefaultValueRule}[]): string[] {
  const byKey = new Map(fields.map(field => [field.key, field]));
  const errors: string[] = [];
  const dependencies = new Map<string, string[]>();
  for (const control of controls) {
    if (!control.fieldKey) continue;
    const field = byKey.get(control.fieldKey);
    const rule = control.defaultRule || field?.defaultRule;
    if (!rule || rule.enabled === false) continue;
    const conditionReferences = (rule.conditions || []).map(condition => condition.sourceField);
    for (const condition of rule.conditions || []) {
      if (!byKey.has(condition.sourceField) || condition.sourceField === control.fieldKey) errors.push('默认值条件引用了不存在的字段或自身');
      if (!['eq','ne','contains','gte','lte','isEmpty','notEmpty'].includes(condition.operator) || (!['isEmpty','notEmpty'].includes(condition.operator) && !condition.value?.trim())) errors.push('请完整填写默认值触发条件');
    }
    dependencies.set(control.fieldKey, conditionReferences);
    if (rule.mode !== 'template') continue;
    const parts = rule.parts || [];
    if (!parts.length || parts.length > 20) errors.push('默认值拼接需要 1～20 个片段');
    if (field?.storageType && !['string', 'text', 'code'].includes(field.storageType)) errors.push('拼接默认值需要文本字段');
    const references = parts.filter(part => part.kind === 'field').map(part => part.value);
    for (const reference of references) {
      const source = byKey.get(reference);
      if (!source || reference === control.fieldKey) errors.push('默认值引用了不存在的字段或自身');
      else if (source.storageType === 'json' || source.computed) errors.push('默认值请引用普通字段');
    }
    dependencies.set(control.fieldKey, [...references, ...conditionReferences]);
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) { errors.push('默认值拼接存在循环引用'); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const source of dependencies.get(key) || []) visit(source);
    visiting.delete(key); visited.add(key);
  };
  for (const key of dependencies.keys()) visit(key);
  return [...new Set(errors)];
}
