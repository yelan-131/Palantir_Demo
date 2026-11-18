import type { CalculationRule } from '@/utils/formCalculations';
import type { ControlSettings, OptionSearchSettings } from '@/utils/formControls';
import type { DefaultValueRule } from '@/utils/formDefaults';
import type { LayoutPlacement } from '@/utils/formLayout';
import React from 'react';
import type { FlowDesignerConfig } from './ProfessionalFlowDesigner';

export type DesignerTab = 'form' | 'dataset' | 'dashboard' | 'filter' | 'style' | 'flow' | 'approval' | 'permission';

export type ComponentPanel = 'components' | 'fieldTypes';

export type ControlSource = 'field' | 'component';

export type ControlWidth = 'third' | 'quarter' | 'half' | 'twoThird' | 'threeQuarter' | 'full';

export type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';

export type DropPosition = 'before' | 'after';

export type ControlRuleKey =
  | 'visible'
  | 'readonly'
  | 'required'
  | 'unique'
  | 'masked'
  | 'copyable'
  | 'optionSort';


export type EncodingResetCycle = 'none' | 'day' | 'month' | 'year' | 'dependency';

export type EncodingSegmentType = 'fixed' | 'date' | 'field' | 'masterData' | 'organization' | 'sequence';

export type EncodingPadding = 'none' | 'leftZero' | 'rightZero' | 'truncate';

export type EncodingGenerationMode = 'auto' | 'manual' | 'autoEditable';

export type EncodingGenerationTiming = 'create' | 'save' | 'submit' | 'workflowNode';

export type EncodingUniquenessScope = 'form' | 'global' | 'organization' | 'dependency';

export type ReferenceSourceKind = 'static' | 'dictionary' | 'masterData' | 'businessForm' | 'organization' | 'externalApi';

export type FieldBusinessType =
  | 'text'
  | 'longText'
  | 'number'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'person'
  | 'relation'
  | 'attachment'
  | 'code';

export type AnalyticsWidgetType = 'metric-card' | 'line' | 'bar' | 'pie' | 'rank-table' | 'detail-table';

export interface AnalyticsDataset {
  id: string;
  name: string;
  sourceType: 'businessForm' | 'ontology' | 'sql' | 'api';
  source: string;
  refreshMode: 'realtime' | 'scheduled' | 'manual';
  refreshInterval?: number;
  dimensions: string[];
  measures: string[];
}

export interface AnalyticsMetric {
  id: string;
  name: string;
  expression: string;
  datasetId: string;
  format: 'number' | 'percent' | 'currency' | 'duration';
  threshold: string;
}

export interface AnalyticsWidget {
  id: string;
  title: string;
  type: AnalyticsWidgetType;
  datasetId: string;
  metricIds: string[];
  dimension?: string;
  width: 'quarter' | 'half' | 'full';
  interaction: 'none' | 'filter' | 'drilldown' | 'navigate';
}

export interface AnalyticsStyle {
  gridSize?: number;
  cardOpacity?: number;
  cardBlur?: number;
  preset: 'clean' | 'executive' | 'factory' | 'dark';
  background: string;
  componentGap: number;
  cardRadius: number;
  cardBorder: 'none' | 'light' | 'strong';
  chartPalette: 'manufacturing' | 'business' | 'warning' | 'mono';
  tableDensity: 'compact' | 'standard' | 'comfortable';
  filterTheme: 'inline' | 'panel' | 'toolbar';
}

export interface AnalyticsDesign {
  datasets: AnalyticsDataset[];
  metrics: AnalyticsMetric[];
  widgets: AnalyticsWidget[];
  globalFilters: string[];
  interactions: Array<{
    sourceWidgetId: string;
    targetWidgetId: string;
    action: 'filter' | 'drilldown' | 'navigate';
  }>;
  style: AnalyticsStyle;
}

export interface ControlRuleCondition {
  sourceField?: string;
  operator?: string;
  value?: string;
  strategy?: string;
  parameter?: string;
  fields?: string[];
  roleIds?: number[];
  keepStart?: number;
  keepEnd?: number;
  note?: string;
}

export interface ControlRule {
  enabled: boolean;
  conditions?: ControlRuleCondition;
  conditionGroups?: ControlRuleCondition[][];
  conditionGroupTitles?: string[];
}

export type ControlRules = Record<ControlRuleKey, ControlRule>;

export interface EncodingSegment {
  id: string;
  name: string;
  type: EncodingSegmentType;
  length: number;
  value?: string;
  sourceField?: string;
  sourceAttribute?: string;
  datePattern?: string;
  resetCycle?: EncodingResetCycle;
  padding?: EncodingPadding;
  sequenceStart?: number;
  sequenceStep?: number;
  regenerateOnChange?: boolean;
  lockAfterGenerated?: boolean;
}

export interface EncodingRule {
  id?: string;
  name?: string;
  priority?: number;
  conditions?: ControlRuleCondition[];
  rules?: EncodingRule[];
  enabled: boolean;
  template: string;
  dependencies: string[];
  resetCycle: EncodingResetCycle;
  sequenceLength: number;
  fixedLength?: number;
  prefix?: string;
  datePattern?: string;
  dependencySegmentLength?: number;
  regenerateOnDependencyChange: boolean;
  allowManualOverride: boolean;
  unique: boolean;
  segments?: EncodingSegment[];
  generationMode?: EncodingGenerationMode;
  generationTiming?: EncodingGenerationTiming;
  uniquenessScope?: EncodingUniquenessScope;
}

export interface ControlTypeSettings extends ControlSettings {}

export interface OptionSearchSchema { kind: string; fields: Array<{value: string; label: string}>; defaultField: string; note?: string }

export interface SearchSettingsDraft { tested?: boolean; controlId: string; settings: OptionSearchSettings; query: string; schema?: OptionSearchSchema; metaLoading: boolean; loading: boolean; error: string; rows: Array<{id: string | number; label: string; matchedFields: string[]}>; page: number; hasMore: boolean; context: Record<string, string> }

export interface AssignmentRule {
  id: string;
  sourceAttribute?: string;
  targetField?: string;
}

export interface DesignerField {
  enumValues?: unknown;
  storageType?: string;
  maxBytes?: number;
  defaultRule?: DefaultValueRule;
  computed?: boolean;
  calculationRule?: CalculationRule;
  key: string;
  name: string;
  type: string;
  businessType?: FieldBusinessType;
  placeholder: string;
  locked?: boolean;
  required?: boolean;
  listVisible?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  defaultValue?: string;
  validation?: string;
  optionSource?: string;
  encodingRule?: EncodingRule;
}

export interface DesignerConfig {
  id: string;
  name: string;
  createTitle: string;
  kind: 'business' | 'analysis';
  appName: string;
  dataSource: string;
  primaryKey: string;
  status: string;
  version: string;
  description: string;
  fields: DesignerField[];
  filters: DesignerField[];
  flowSteps: string[];
  roles: string[];
}

export interface ComponentDefinition {
  key: string;
  category: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  controlType: string;
  defaultWidth?: ControlWidth;
}

export interface LayoutControl extends LayoutPlacement {
  id: string;
  source: ControlSource;
  controlType: string;
  name: string;
  desc?: string;
  fieldKey?: string;
  placeholder?: string;
  helpText?: string;
  optionSource?: string;
  referenceLabelField?: string;
  referenceValueField?: string;
  referenceItemsPath?: string;
  dataSourceKind?: ReferenceSourceKind;
  encodingRule?: EncodingRule;
  assignmentRules?: AssignmentRule[];
  assignmentRulesEnabled?: boolean;
  defaultRule?: DefaultValueRule;
  computed?: CalculationRule | null;
  calculationRulesEnabled?: boolean;
  inactiveCalculationRule?: CalculationRule;
  storageMaxBytes?: number;
  typeSettings?: ControlTypeSettings;
  width: ControlWidth;
  rules: ControlRules;
}

export interface FlowNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
}

export interface FlowConnection {
  id: string;
  fromId: string;
  fromSide: FlowPortSide;
  toId: string;
  toSide: FlowPortSide;
}

export interface FlowNodeDefinition {
  key: string;
  name: string;
  desc: string;
  role: string;
  icon: React.ReactNode;
}

export interface BusinessSection {
  key: string;
  title: string;
  desc: string;
  fieldKeys: string[];
}

export interface DesignerOption {
  value: string;
  label: string;
}

export interface DesignerMetaConfig {
  controlTypeOptions?: DesignerOption[];
  typeSettingOptions?: {
    textFormats?: DesignerOption[];
    textTrimModes?: DesignerOption[];
    textCaseModes?: DesignerOption[];
    selectionModes?: DesignerOption[];
    selectionDisplays?: DesignerOption[];
    dateModes?: DesignerOption[];
    defaultDates?: DesignerOption[];
    encodingResetCycles?: DesignerOption[];
  };
  componentLibrary?: Array<{
    category: string;
    items: Array<{
      key: string;
      name: string;
      desc?: string;
      controlType: string;
      defaultWidth?: ControlWidth;
      iconKey?: string;
    }>;
  }>;
  commonControlKeys?: string[];
  businessSections?: BusinessSection[];
}

export interface DesignerMeta {
  controlTypeOptions: DesignerOption[];
  textFormatOptions: DesignerOption[];
  textTrimModeOptions: DesignerOption[];
  textCaseModeOptions: DesignerOption[];
  selectionModeOptions: DesignerOption[];
  selectionDisplayOptions: DesignerOption[];
  dateModeOptions: DesignerOption[];
  defaultDateOptions: DesignerOption[];
  encodingResetCycleOptions: DesignerOption[];
  componentGroups: Array<{ category: string; items: ComponentDefinition[] }>;
  commonControlKeys: string[];
  businessSections?: BusinessSection[];
}

export interface WorkflowDesignerMeta {
  draftWorkflowId?: number;
  publishedWorkflowId?: number;
  publishedAt?: string;
  publishedVersion?: number;
}

export interface ViewConfigMeta {
  draftVersion?: number;
  publishedVersion?: number;
  draftSavedAt?: string;
  publishedAt?: string;
  status?: 'draft' | 'published';
}

export interface PermissionDesignDraft {
  page: Record<string, boolean>;
  actions: Record<string, boolean>;
  fields: Record<string, {
    visible: boolean;
    editable: boolean;
    required: boolean;
    exportable: boolean;
  }>;
  data: {
    scope: string;
    orgUnits: number[];
    sensitiveFields: string;
    ownership: Record<string, boolean>;
  };
}

export type PermissionDraftMap = Record<string, PermissionDesignDraft>;

export interface FormPermissionRow {
  id: number;
  role_id: number;
  action: string;
  effect: 'allow' | 'deny' | string;
  field_name?: string | null;
}

export interface WorkflowDefinitionPayload {
  id: number;
  name: string;
  description?: string;
  config?: Partial<FlowDesignerConfig> & Record<string, unknown>;
  form_config?: Record<string, unknown>;
  status?: string;
  version?: number;
}

export interface WorkflowBindingPayload {
  id: number;
  form_id: number;
  workflow_id: number;
  trigger_action: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
