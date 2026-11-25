import './style.css';
import './designer-dialog.css';
import { Button, Checkbox, Dropdown, Form, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { ApartmentOutlined, ArrowLeftOutlined, CalendarOutlined, CheckCircleOutlined, CheckSquareOutlined, DatabaseOutlined, DeleteOutlined, EyeOutlined, HistoryOutlined, HolderOutlined, LayoutOutlined, LockOutlined, NumberOutlined, PlusOutlined, QuestionCircleOutlined, RedoOutlined, SaveOutlined, SearchOutlined, SettingOutlined, TableOutlined, UndoOutlined, UserSwitchOutlined } from '@/components/Icon/ant';
import type { CalculationRule } from '@/utils/formCalculations';
import { cloneLayoutSubtree, isLayoutContainer, isLayoutControl, layoutDescendants, layoutSlots, normalizeLayout, placeLayoutControl, unwrapLayoutControl } from '@/utils/formLayout';
import { defaultRuleErrors } from '@/utils/formDefaults';
import type { DefaultValueRule } from '@/utils/formDefaults';
import type { NewFormDraft, PageAction } from '@/components/AiChatWidget/pageControls';
import { businessDataDesignPath } from '@/config/navigation';
import { enumOptions, matchesOptionSearch } from '@/utils/formControls';
import type { OptionSearchSettings } from '@/utils/formControls';
import { adminListOrgUnits, adminListRoles, adminListUsers, createPlatformForm, createPlatformFormField, getFormOptionSources, getPlatformForm, getPlatformFormByCode, listPlatformFormLayouts, listPlatformFormPermissions, listPlatformForms, listWorkflowBindings, previewDesignerRules, previewFormReferenceOptions, previewOptionSearchSchema, publishPlatformForm, restorePlatformFormDraft, updatePlatformForm, updatePlatformFormField, upsertPlatformFormLayout, wfCreateDefinition, wfGetDefinition, wfUpdateDefinition } from '@/services/api';
import type { PlatformForm, PlatformFormField, PlatformFormPublishReport } from '@/services/api';
import { FormAppearanceHeader, normalizeFormAppearance, type FormAppearance } from '@/components/FormLayout/formAppearance';
import { PropertyGroup, PropertyInspectorHeader, PropertyRow } from '@/components/PropertyInspector';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalizeViewConfig } from '@/utils/viewConfig';
import type { ViewConfig } from '@/utils/viewConfig';
import { applyAiLayoutOperations, describeAiLayout } from '@/utils/aiFormLayout';
import { restoreDesignerLayout } from './designerLayout';
import { createPortal } from 'react-dom';
import { createUuid } from '@/utils/uuid';
import { normalizeSelection, parseStaticOptions, selectionConfigErrors, selectionCountError, staticOptionErrors } from '@/utils/selectOptions';
import { useAiWorkbench } from '@/components/AiChatWidget/context';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useShellPageTitle } from '@/components/ShellPageTitle';
import ProfessionalFlowDesigner, { validateFlowDesignerConfig } from './ProfessionalFlowDesigner';
import type { FlowDesignerConfig } from './ProfessionalFlowDesigner';
import { RuleToggleControl } from './RuleToggleControl';
import VersionManager from './VersionManager';
import { configs, defaultConfig, getStoredAnalyticsDesign, inferDesignerKindFromMeta, inferFormDesignerKind, isNumericFormRouteId, makeDefaultAnalyticsDesign, resolvePlatformFormForConfig } from './designerConfig';
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH, encodingDatePatternOptions, encodingGenerationModeOptions, encodingPaddingOptions, encodingSegmentTypeOptions, ruleLabels, ruleOperatorOptions, ruleStrategyOptions } from './designerOptions';
import type { AnalyticsDesign, AssignmentRule, ComponentDefinition, ComponentPanel, ControlRule, ControlRuleCondition, ControlRuleKey, ControlTypeSettings, ControlWidth, DesignerConfig, DesignerField, DropPosition, EncodingRule, EncodingSegment, FlowConnection, FlowNode, FlowNodeDefinition, FlowPortSide, FormPermissionRow, LayoutControl, OptionSearchSchema, PermissionDesignDraft, PermissionDraftMap, SearchSettingsDraft, ViewConfigMeta, WorkflowBindingPayload, WorkflowDefinitionPayload, WorkflowDesignerMeta } from './designerTypes';
import { encodingSegmentLengthError, getDateSegmentLength, getEncodingRules, getEncodingSegmentTypeLabel, getEncodingSegments, makeEncodingRule, makeEncodingSegment, renderEncodingSample } from './encodingRules';
import { getFieldBusinessType, isEncodingField, mapDesignerFieldType } from './fieldBusinessType';
import { alertBusinessSections, designerFieldsToViewFields, getDefaultTypeSettings, getDesignerMeta, getEffectiveControlTypeForControl, getFlowNodeAssigneeLabel, getPreviewNodeNote, getReferenceConfig, inferFieldControlType, inferReferenceSourceKind, isDataSourceControlType, isEditableTarget, makeAiLayoutControl, makeComponentControl, makeControlRules, makeFieldControl, normalizeBusinessSections, normalizeControlRules, optionSourceToOptions } from './fieldModel';
import { makeFlowConnections, makeFlowNodes } from './flowGeometry';
import { applyNativeFieldProperties, draftFieldToDesignerField } from './nativeDraft';
import { defaultRoleFieldPermission, getDefaultPermissionActionEnabled, makePermissionDesignDraft, permissionActionDefinitions, permissionActionGroups, permissionDraftsFromConfig, permissionDraftsFromRows, sanitizePermissionDesignDraft } from './permissionDrafts';
import { areDesignerFieldsSame, platformFieldsToDesignerFields } from './platformFields';
import { previewFlowNodes as associatedPreviewNodes, previewFieldPermission } from './previewPermissions';
import { getStoredViewConfig, getViewConfigMeta, getWorkflowDesignerMeta, makeDesignerViewConfig, makeProfessionalFlowConfig, makeRuntimeFormLayout, makeWorkflowConfigPayload, makeWorkflowFormConfig, normalizeProfessionalFlowConfig } from './workflowConfig';

import { CanvasControl, ContainerProperties, PreviewContent, TableProperties } from './CanvasStage';
import type { CanvasActions, CanvasScope } from './CanvasStage';
import { AssignmentEditor, CalculationEditor, ControlIdentityProperties, DataAttributeProperties, DefaultValueEditor, FormAppearanceProperties, InteractionProperties, LayoutAppearanceProperties, LayoutWidthProperties, SearchSettingsEditor, TypeSpecificProperties } from './PropertyPanels';
import type { PropertyPanelActions, PropertyPanelScope } from './PropertyPanels';

export interface SourceEditorTargets {properties:HTMLElement|null;actions:HTMLElement|null;status:HTMLElement|null}

export interface EmbeddedDraftStatus {
  dirty: boolean;
  saving: boolean;
}

export interface EmbeddedDraftGuard {
  onStatusChange: (status: EmbeddedDraftStatus) => void;
  saveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

type SourceDesignerTab = 'form' | 'flow';
type DesignerTab = SourceDesignerTab | 'permission';

function StandaloneDraftGuard({ dirty }: { dirty: boolean }) {
  const location = useLocation();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty
    // A pending designer can mount before React Router commits navigation.
    && currentLocation.pathname === location.pathname
    && currentLocation.search === location.search
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
      || currentLocation.state?.aiDesignPreviewId !== nextLocation.state?.aiDesignPreviewId));
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const modal = Modal.confirm({
      className: 'form-designer-dialog',
      title: '当前有未保存修改',
      content: '离开后本次修改不会保留。请先保存草稿，或确认放弃修改。',
      okText: '放弃并离开',
      cancelText: '继续编辑',
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => modal.destroy();
  }, [blocker]);
  return null;
}

export interface FormSettingsPageProps {
  workspaceTargets?: SourceEditorTargets;
  requestExitRef?:React.MutableRefObject<(()=>void)|null>;
  embeddedDraftGuard?: EmbeddedDraftGuard;
  formId: string;
  initialTab?: DesignerTab;
  requestedTab?: SourceDesignerTab;
  onTabChange?: (tab: SourceDesignerTab) => void;
  onExit?: () => void;
  onPublished?: () => void;
}

export default function FormSettingsPage({ formId, initialTab = 'form', requestedTab, onTabChange, onExit, onPublished, workspaceTargets, requestExitRef, embeddedDraftGuard }: FormSettingsPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const permissionOnly = initialTab === 'permission';
  const aiFormDraft = formId === 'new' ? location.state?.aiFormDraft as (NewFormDraft & { id: string }) | undefined : undefined;
  const staticBaseConfig = useMemo(
    () => {
      if (aiFormDraft) return {
        ...defaultConfig, id: aiFormDraft.code, name: aiFormDraft.name,
        createTitle: `新增${aiFormDraft.name}`, description: aiFormDraft.description,
        dataSource: aiFormDraft.code, filters: [], flowSteps: [],
        fields: aiFormDraft.fields.map(draftFieldToDesignerField),
      } satisfies DesignerConfig;
      if (formId && configs[formId]) return configs[formId];
      const fallbackId = formId || defaultConfig.id;
      return {
        ...defaultConfig,
        id: fallbackId,
        kind: inferDesignerKindFromMeta(defaultConfig.kind, fallbackId),
      };
    },
    [formId, aiFormDraft],
  );
  const initializedAiDraft = useRef<string>();
  const lastSavedForm = useRef<PlatformForm | null>(null);
  const [draftReviewReady, setDraftReviewReady] = useState(false);
  const isPlatformFormRoute = Boolean(formId && isNumericFormRouteId(formId));
  const [databaseFieldsByForm, setDatabaseFieldsByForm] = useState<Record<string, DesignerField[]>>({});
  const [databaseMetaByForm, setDatabaseMetaByForm] = useState<Record<string, {
    dataSource?: string;
    description?: string;
    kind?: DesignerConfig['kind'];
    name?: string;
    code?: string;
  }>>({});
  const baseConfig = useMemo<DesignerConfig>(() => {
    const databaseFields = databaseFieldsByForm[staticBaseConfig.id];
    const databaseMeta = databaseMetaByForm[staticBaseConfig.id];
    if (!databaseFields && !databaseMeta) return staticBaseConfig;
    return {
      ...staticBaseConfig,
      id: databaseMeta?.code || staticBaseConfig.id,
      name: databaseMeta?.name || staticBaseConfig.name,
      createTitle: databaseMeta?.name ? `新增${databaseMeta.name}` : staticBaseConfig.createTitle,
      kind: databaseMeta?.kind || staticBaseConfig.kind,
      fields: databaseFields ?? staticBaseConfig.fields,
      dataSource: databaseMeta?.dataSource || staticBaseConfig.dataSource,
      description: databaseMeta?.description || staticBaseConfig.description,
    };
  }, [databaseFieldsByForm, databaseMetaByForm, staticBaseConfig]);
  useShellPageTitle(permissionOnly ? `${baseConfig.name} · 权限管理` : `${baseConfig.name}配置`, Boolean(aiFormDraft) || permissionOnly);
  const [activeTab, setActiveTab] = useState<DesignerTab>(initialTab);
  const [componentPanel, setComponentPanel] = useState<ComponentPanel>('fieldTypes');
  const [version, setVersion] = useState('v1');
  const [storedViewConfig, setViewConfig] = useState<ViewConfig>(() => makeDesignerViewConfig(baseConfig));
  const [identityUsers, setIdentityUsers] = useState<Array<{ id: number; username: string; label: string }>>([]);
  const [analyticsDesign, setAnalyticsDesign] = useState<AnalyticsDesign>(() => makeDefaultAnalyticsDesign(baseConfig));
  const [layoutControls, setLayoutControls] = useState<LayoutControl[]>(baseConfig.fields.map(makeFieldControl));
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [defaultValueDraft, setDefaultValueDraft] = useState<{ controlId: string; rule: DefaultValueRule; fixed: string } | null>(null);
  const [calculationDraft, setCalculationDraft] = useState<{ controlId: string; rule: CalculationRule; samples: Record<string, unknown> } | null>(null);
  const [calculationBusy, setCalculationBusy] = useState(false);
  const [calculationError, setCalculationError] = useState('');
  const [calculationResult, setCalculationResult] = useState<{ value: unknown } | null>(null);
  const calculationEpoch = useRef(0);
  const [assignmentDraft, setAssignmentDraft] = useState<{ controlId: string; rules: AssignmentRule[] } | null>(null);
  const [searchDraft, setSearchDraft] = useState<SearchSettingsDraft | null>(null);
  const searchRequestEpoch = useRef(0);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(baseConfig.fields[0]?.key || '');
  const [containerTabs, setContainerTabs] = useState<Record<string, string>>({});
  const [copiedTree, setCopiedTree] = useState<LayoutControl[]>([]);
  const [copiedControl, setCopiedControl] = useState<LayoutControl | null>(null);
  const [history, setHistory] = useState<LayoutControl[][]>([]);
  const [future, setFuture] = useState<LayoutControl[][]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [canvasSettings,setCanvasSettings]=useState({columns:2,gap:12});
  const [showCanvasGrid, setShowCanvasGrid] = useState(false);
  const [formAppearance, setFormAppearance] = useState<FormAppearance>({});
  const renderedAppearance = normalizeFormAppearance(formAppearance);
  const savedAppearance = Object.keys(renderedAppearance).length ? renderedAppearance : undefined;
  const [previewForm]=Form.useForm();
  const [previewValues,setPreviewValues]=useState<Record<string,unknown>>({});
  const [previewStates,setPreviewStates]=useState<Record<string,{visible:boolean;required:boolean;readonly:boolean;masked?:boolean;copyMode?:'normal'|'maskedCopy'|'disabled';copyText?:string}>>({});
  const [previewRuleError,setPreviewRuleError]=useState('');
  const previewEpoch=useRef(0);
  const [flowLoadError, setFlowLoadError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRole, setPreviewRole] = useState('');
  const [hasAssociatedFlow, setHasAssociatedFlow] = useState(false);
  const [previewFlowNodeId, setPreviewFlowNodeId] = useState('');
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [designerReloadKey, setDesignerReloadKey] = useState(0);
  const restoredDesignFormId = useRef<number | null>(null);
  useEffect(() => { restoredDesignFormId.current = null; }, [staticBaseConfig.id]);
  const [draggedControlId, setDraggedControlId] = useState('');
  const [dropHint, setDropHint] = useState<{ controlId: string; position: DropPosition } | null>(null);
  const [isCanvasDragActive, setCanvasDragActive] = useState(false);
  const [fieldDefaultValueDrafts, setFieldDefaultValueDrafts] = useState<Record<string, string>>({});
  const ruleOpeningValue=useRef<{id:string;key:ControlRuleKey;value:ControlRule}|null>(null);
  const [ruleModal, setRuleModal] = useState<{ controlId: string; ruleKey: ControlRuleKey } | null>(null);
  const [editingRuleGroupTitle, setEditingRuleGroupTitle] = useState<{ ruleKey: ControlRuleKey; groupIndex: number; value: string } | null>(null);
  const [ruleWindowMode, setRuleWindowMode] = useState<'common' | 'custom'>('common');
  const [encodingSegmentEditor, setEncodingSegmentEditor] = useState<{
    open: boolean;
    index?: number;
    draft: EncodingSegment;
  }>(() => ({ open: false, draft: makeEncodingSegment('fixed', baseConfig.fields) }));
  const [professionalFlowConfig, setProfessionalFlowConfig] = useState<FlowDesignerConfig>(() => makeProfessionalFlowConfig(baseConfig));
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const viewConfigMeta = getViewConfigMeta(platformForm);
  useEffect(()=>{if(!previewOpen||baseConfig.kind==='analysis'||!platformForm?.id)return;const epoch=++previewEpoch.current;let active=true;const timer=setTimeout(()=>{previewDesignerRules(platformForm.id,layoutControls,previewValues).then(response=>{if(!active||epoch!==previewEpoch.current)return;const result=response.data?.data;setPreviewStates(result?.states||{});previewForm.setFieldsValue(result?.data||{});setPreviewRuleError('');}).catch((error)=>{if(active)setPreviewRuleError(error?.response?.data?.detail || '规则预览失败，请检查条件配置或网络连接。');});},250);return()=>{active=false;clearTimeout(timer);};},[previewOpen,platformForm?.id,layoutControls,previewValues,previewForm]);

  const [formPermissionRows, setFormPermissionRows] = useState<FormPermissionRow[]>([]);
  const [isResolvingPlatformConfig, setResolvingPlatformConfig] = useState(Boolean(formId));
  const designerMeta = useMemo(() => getDesignerMeta(platformForm), [platformForm]);
  const {
    controlTypeOptions,
    textFormatOptions,
    textTrimModeOptions,
    textCaseModeOptions,
    selectionModeOptions,
    selectionDisplayOptions,
    dateModeOptions,
    defaultDateOptions,
    encodingResetCycleOptions,
    componentGroups,
    commonControlKeys,
  } = designerMeta;
  const commonControls = useMemo(
    () => commonControlKeys
      .map((key) => componentGroups.flatMap((group) => group.items).find((item) => item.key === key))
      .filter((item): item is ComponentDefinition => Boolean(item)),
    [commonControlKeys, componentGroups],
  );
  const [encodingSettingsDraft, setEncodingSettingsDraft] = useState<EncodingRule | null>(null);
  const [encodingSegmentEditPart, setEncodingSegmentEditPart] = useState<'type' | 'length' | 'value' | 'padding'>('type');
  const encodingEditorRef = useRef<HTMLDivElement>(null);
  const encodingRuleTargetRef = useRef<{ controlId: string; rule: EncodingRule } | null>(null);
  const [draggedEncodingSegmentId, setDraggedEncodingSegmentId] = useState<string | null>(null);
  const encodingSegmentPointer = useRef<{ id: string; x: number; y: number } | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowDesignerMeta>({});
  const [isPersistingFlow, setPersistingFlow] = useState(false);
  const [isPersistingPermissions, setPersistingPermissions] = useState(false);
  const [identityRoleRecords, setIdentityRoleRecords] = useState<Array<{ id: number; name: string; label: string }>>([]);
  const [identityRoles, setIdentityRoles] = useState<string[]>([]);
  const [identityOrgUnits, setIdentityOrgUnits] = useState<Array<{ id: number; name: string; code?: string; status?: string }>>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<PermissionDraftMap>({});
  const [permissionRoleSearch,setPermissionRoleSearch]=useState('');
  const permissionRoles = identityRoles.length ? identityRoles : baseConfig.roles;
  const permissionOrgUnits = identityOrgUnits.filter((org) => org.status !== 'inactive');
  const permissionOrgUnitIds = permissionOrgUnits.map((org) => org.id);
  const permissionOrgUnitKey = permissionOrgUnitIds.join(',');
  const permissionOrgUnitOptions = permissionOrgUnits.map((org) => ({
    value: org.id,
    label: org.code ? `${org.name} / ${org.code}` : org.name,
  }));
  useEffect(() => {
    if (!platformForm) return;
    const configDrafts = permissionDraftsFromConfig(platformForm.config);
    const rowDrafts = formPermissionRows.length
      ? permissionDraftsFromRows(formPermissionRows, identityRoleRecords, baseConfig.fields, permissionOrgUnitIds)
      : {};
    setPermissionDrafts(configDrafts);
  }, [baseConfig.fields, formPermissionRows, identityRoleRecords, permissionOrgUnitKey, platformForm]);
  const [selectedPermissionRole, setSelectedPermissionRole] = useState('');
  const [fieldPermissionQuery, setFieldPermissionQuery] = useState('');
  const [fieldPermissionFilter, setFieldPermissionFilter] = useState<'all' | 'hidden' | 'editable' | 'required' | 'exportable'>('all');
  const [fieldPermissionPage, setFieldPermissionPage] = useState(1);
  const activePermissionRole = selectedPermissionRole || permissionRoles[0] || '未配置角色';
  const activePermissionRoleIndex = Math.max(permissionRoles.indexOf(activePermissionRole), 0);
  const activePermissionRoleKind = activePermissionRoleIndex === 0 ? 'system' : activePermissionRoleIndex < 4 ? 'manager' : 'operator';
  const activePermissionDraft = permissionDrafts[activePermissionRole] || permissionDraftsFromRows(formPermissionRows,identityRoleRecords,baseConfig.fields,permissionOrgUnitIds)[activePermissionRole] || makePermissionDesignDraft(activePermissionRoleKind, permissionOrgUnitIds);
  const getRoleFieldPermission = (field: DesignerField, index: number) => {
    const configured = activePermissionDraft.fields?.[field.key];
    return configured || {
      visible: true,
      editable: !field.locked && (activePermissionRoleKind === 'system' || index < 5),
      required: Boolean(field.required),
      exportable: activePermissionRoleKind !== 'operator' || index <= 4,
    };
  };
  const updateActivePermissionDraft = (updater: (draft: PermissionDesignDraft) => PermissionDesignDraft) => {
    setPermissionDrafts((current) => {
      const baseDraft = current[activePermissionRole] || activePermissionDraft;
      return { ...current, [activePermissionRole]: updater(baseDraft) };
    });
    setHasUnsavedChanges(true);
  };
  const updateRoleFieldPermission = (field: DesignerField, index: number, patch: Partial<ReturnType<typeof getRoleFieldPermission>>) => {
    const currentPermission = getRoleFieldPermission(field, index);
    updateActivePermissionDraft((draft) => ({
      ...draft,
      fields: {
        ...(draft.fields || {}),
        [field.key]: { ...currentPermission, ...patch },
      },
    }));
  };
  const getFieldDefaultValue = (field?: DesignerField) => {
    if (!field) return '';
    return fieldDefaultValueDrafts[field.key] ?? field.defaultValue ?? '';
  };
  const updateFieldDefaultValue = (field: DesignerField | undefined, value: string) => {
    if (!field) return;
    setFieldDefaultValueDrafts((current) => ({ ...current, [field.key]: value }));
    setHasUnsavedChanges(true);
  };
  const previewFlowNodes = useMemo(
    () => associatedPreviewNodes(professionalFlowConfig.nodes, hasAssociatedFlow),
    [professionalFlowConfig.nodes, hasAssociatedFlow],
  );
  const selectedPreviewFlowNode = useMemo(
    () => previewFlowNodes.find((node) => node.id === previewFlowNodeId) || previewFlowNodes[0],
    [previewFlowNodeId, previewFlowNodes],
  );
  const previewFlowNodeOptions = useMemo(
    () => previewFlowNodes.map((node) => ({
      value: node.id,
      label: `${node.label} · ${getFlowNodeAssigneeLabel(node)}`,
    })),
    [previewFlowNodes],
  );
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() => makeFlowNodes(baseConfig.flowSteps));
  const [flowConnections, setFlowConnections] = useState<FlowConnection[]>(() => makeFlowConnections(makeFlowNodes(baseConfig.flowSteps)));
  const [pendingFlowPort, setPendingFlowPort] = useState<{ nodeId: string; side: FlowPortSide } | null>(null);
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const draggingFlowNodeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);
  const isAnalysisDesigner = baseConfig.kind === 'analysis';
  const isNoLeftTab = activeTab !== 'form';

  // External tab navigation changes only the visible panel, never reinitializes drafts.
  useEffect(() => {
    setActiveTab(requestedTab ?? initialTab);
    setSelectedControlId('');
  }, [requestedTab, initialTab]);

  useEffect(() => {
    adminListUsers().then((response) => setIdentityUsers((response.data?.data || [])
      .filter((user: any) => user.is_active !== false)
      .map((user: any) => ({ id: Number(user.id), username: String(user.username), label: `${user.display_name || user.username} (${user.username})` }))))
      .catch(() => message.warning('用户列表加载失败，暂时无法选择绑定用户，请刷新重试'));
  }, []);

  useEffect(() => {
    Promise.all([adminListRoles(), adminListOrgUnits()])
      .then(([roleRes, orgRes]) => {
        const roleRecords = (roleRes.data?.data || []).map((role: any) => ({
          id: Number(role.id),
          name: String(role.name || ''),
          label: String(role.label || role.name || ''),
        })).filter((role: { id: number; label: string }) => Number.isFinite(role.id) && role.label);
        setIdentityRoleRecords(roleRecords);
        setIdentityRoles(roleRecords.map((role: { label: string }) => role.label));
        setIdentityOrgUnits((orgRes.data?.data || [])
          .map((org: any) => ({
            id: Number(org.id),
            name: String(org.name || ''),
            code: org.code ? String(org.code) : undefined,
            status: org.status ? String(org.status) : undefined,
          }))
          .filter((org: { id: number; name: string }) => Number.isFinite(org.id) && org.name));
      })
      .catch(() => {
        setIdentityRoles([]);
        setIdentityOrgUnits([]);
      });
  }, []);

  useEffect(() => {
    if (permissionRoles.length && !permissionRoles.includes(activePermissionRole)) {
      setSelectedPermissionRole(permissionRoles[0]);
    }
  }, [activePermissionRole, permissionRoles]);

  useEffect(() => {
    if (aiFormDraft && initializedAiDraft.current === aiFormDraft.id) return;
    initializedAiDraft.current = aiFormDraft?.id;
    setDraftReviewReady(false);
    const nextControls = baseConfig.fields.map(makeFieldControl);
    setLayoutControls(nextControls);
    setSelectedControlId(nextControls[0]?.id || '');
    setSelectedAssetKey(baseConfig.fields[0]?.key || '');
    setViewConfig(makeDesignerViewConfig(baseConfig));
    setAnalyticsDesign(makeDefaultAnalyticsDesign(baseConfig));
    setVersion(baseConfig.version);
    setCopiedControl(null);
    setHistory([]);
    setFuture([]);
    setLibrarySearch('');
    setHasUnsavedChanges(Boolean(aiFormDraft));
    setPreviewOpen(false);
    setVersionPanelOpen(false);
    setPreviewFlowNodeId('');
    setPreviewRole('');
    setHasAssociatedFlow(false);
    setDraggedControlId('');
    setDropHint(null);
    setCanvasDragActive(false);
    setFieldDefaultValueDrafts({});
    setRuleModal(null);
    setProfessionalFlowConfig(makeProfessionalFlowConfig(baseConfig));
    setPlatformForm((current) => {
      if (!current) return null;
      if (current.code === staticBaseConfig.id || String(current.id) === staticBaseConfig.id) return current;
      if (isPlatformFormRoute && String(current.id) === String(formId)) return current;
      return null;
    });
    setFormPermissionRows([]);
    setWorkflowMeta({});
    setPermissionDrafts({});
    const nextFlowNodes = makeFlowNodes(baseConfig.flowSteps);
    setFlowNodes(nextFlowNodes);
    setFlowConnections(makeFlowConnections(nextFlowNodes));
    setPendingFlowPort(null);
  }, [baseConfig.id, baseConfig.kind, baseConfig.version, baseConfig.fields, baseConfig.flowSteps, formId, isPlatformFormRoute, staticBaseConfig.id]);

  useEffect(() => {
    if (!previewFlowNodeOptions.length) {
      if (previewFlowNodeId) setPreviewFlowNodeId('');
      return;
    }
    if (!previewFlowNodeOptions.some((item) => item.value === previewFlowNodeId)) {
      setPreviewFlowNodeId(previewFlowNodeOptions[0].value);
    }
  }, [previewFlowNodeId, previewFlowNodeOptions]);

  useEffect(() => {
    let cancelled = false;
    const loadPersistedFlow = async () => {
      // A new form stays entirely in this existing editor until the user saves.
      if (aiFormDraft) { setResolvingPlatformConfig(false); return; }
      setResolvingPlatformConfig(true);
      setFlowLoadError('');
      try {
        const formDetail = await resolvePlatformFormForConfig(staticBaseConfig.id);
        if (!formDetail || cancelled) return;
        if (cancelled) return;
        const databaseFields = platformFieldsToDesignerFields(formDetail.fields);
        setDatabaseFieldsByForm((current) => {
          if (areDesignerFieldsSame(current[staticBaseConfig.id], databaseFields)) return current;
          return { ...current, [staticBaseConfig.id]: databaseFields };
        });
        setDatabaseMetaByForm((current) => ({
          ...current,
          [staticBaseConfig.id]: {
            name: formDetail.name || baseConfig.name,
            code: formDetail.code || baseConfig.id,
            dataSource: formDetail.table_name || baseConfig.dataSource,
            description: formDetail.description || baseConfig.description,
            kind: inferFormDesignerKind(formDetail),
          },
        }));
        setPlatformForm(formDetail);
        setFormAppearance(normalizeFormAppearance(formDetail.config?.formAppearance));
        const savedCanvas=formDetail.config?.canvasSettings as {columns?:number;gap?:number}|undefined;
        setCanvasSettings({columns:[1,2,3].includes(Number(savedCanvas?.columns))?Number(savedCanvas?.columns):2,gap:[8,12,16].includes(Number(savedCanvas?.gap))?Number(savedCanvas?.gap):12});
        let layouts: Array<{ layout_type?: string; config?: Record<string, unknown>; updated_at?: string }> = [];
        try {
          const response = await listPlatformFormLayouts(formDetail.id);
          layouts = response.data?.data || [];
        } catch (error) {
          console.warn('form layouts load failed', error);
        }
        if (cancelled) return;
        const formLayout = layouts.find(layout => layout.layout_type === 'form');
        const designerSavedAt = Date.parse(getViewConfigMeta(formDetail).draftSavedAt || '');
        const layoutSavedAt = Date.parse(formLayout?.updated_at || '');
        const storedLayout = designerSavedAt > layoutSavedAt ? undefined : formLayout?.config;
        const restoredControls = restoreDesignerLayout(databaseFields, formDetail.config?.formDesignerControls,
          formDetail.config?.formLayout, storedLayout);
        setLayoutControls(restoredControls);
        setSelectedControlId(restoredControls[0]?.id || '');
        const storedAnalyticsDesign = getStoredAnalyticsDesign(formDetail, {
          ...baseConfig,
          kind: inferFormDesignerKind(formDetail),
        });
        setAnalyticsDesign(storedAnalyticsDesign);
        setPermissionDrafts(permissionDraftsFromConfig({...formDetail.config,permissionDesign:formDetail.config?.permissionDesignDraft||formDetail.config?.permissionDesign}));
        try {
          const permissionsResponse = await listPlatformFormPermissions(formDetail.id);
          if (!cancelled) {
            setFormPermissionRows((permissionsResponse.data?.data || []) as FormPermissionRow[]);
          }
        } catch (error) {
          console.warn('form permissions load failed', error);
          if (!cancelled) setFormPermissionRows([]);
        }
        const viewSourceFields = databaseFields;
        let persistedViewConfig = getStoredViewConfig(formDetail, baseConfig);
        if (!persistedViewConfig && restoredDesignFormId.current !== formDetail.id) {
          const layoutConfig = layouts.find(layout => layout.layout_type === 'view')?.config || {};
          const layoutView = layoutConfig.draft || layoutConfig.published;
          if (layoutView) {
            persistedViewConfig = normalizeViewConfig(
              layoutView, designerFieldsToViewFields(viewSourceFields), baseConfig.filters.map(filter => filter.key),
            );
          }
        }
        if (!cancelled) {
          setViewConfig(persistedViewConfig || makeDesignerViewConfig(baseConfig));
        }
        const meta = getWorkflowDesignerMeta(formDetail);
        setWorkflowMeta(meta);
        let workflowId = meta.draftWorkflowId || meta.publishedWorkflowId;
        let boundTrigger: WorkflowBindingPayload | undefined;
        if (!workflowId) {
          const bindingsResponse = await listWorkflowBindings(formDetail.id);
          const bindings = (bindingsResponse.data?.data || []) as WorkflowBindingPayload[];
          boundTrigger = bindings.find((binding) => binding.enabled && ['submit', 'manual_submit'].includes(binding.trigger_action));
          workflowId = boundTrigger?.workflow_id;
        }
        if (!workflowId) {
          setProfessionalFlowConfig(makeProfessionalFlowConfig(baseConfig));
          setHasUnsavedChanges(false);
          return;
        }
        const definitionResponse = await wfGetDefinition(workflowId);
        if (cancelled) return;
        const definition = definitionResponse.data as WorkflowDefinitionPayload;
        if (definition.config && (definition.config.nodes || definition.config.steps)) {
          const defaultFlow = makeProfessionalFlowConfig(baseConfig);
          const nextConfig = normalizeProfessionalFlowConfig({
            ...definition.config,
            version: definition.version ? `v${definition.version}` : String(definition.config.version || defaultFlow.version),
          }, defaultFlow);
          if (boundTrigger) {
            nextConfig.triggerBindings = nextConfig.triggerBindings.map((binding) => binding.action === 'submit'
              ? { ...binding, action: boundTrigger!.trigger_action, enabled: true } : binding);
          }
          setProfessionalFlowConfig(nextConfig);
          setHasAssociatedFlow(true);
          setVersion(nextConfig.version);
          setHasUnsavedChanges(false);
        }
      } catch (error) {
        console.warn('workflow designer load failed', error);
        if (!cancelled) {
          setFlowLoadError('已有流程加载失败，请刷新重试；为避免覆盖原流程，暂时禁止保存和发布。');
          message.error('已有流程加载失败，请刷新后重试');
        }
      } finally {
        if (!cancelled) setResolvingPlatformConfig(false);
      }
    };
    loadPersistedFlow();
    return () => {
      cancelled = true;
    };
  }, [baseConfig.id, baseConfig.name, baseConfig.version, baseConfig.fields, baseConfig.flowSteps, staticBaseConfig.id, designerReloadKey]);

  const selectedControl = useMemo(
    () => layoutControls.find((control) => control.id === selectedControlId),
    [layoutControls, selectedControlId],
  );
  const canvasFieldKeySet = useMemo(
    () => new Set(layoutControls.map((control) => control.fieldKey).filter(Boolean)),
    [layoutControls],
  );
  const selectedField = baseConfig.fields.find(field => field.key === (selectedControl?.fieldKey || selectedAssetKey));
  const selectedEffectiveControlType = getEffectiveControlTypeForControl(selectedControl, selectedField);
  const selectedControlUsesDataSource = Boolean(
    selectedControl && isDataSourceControlType(selectedEffectiveControlType),
  );
  const selectedReferenceSourceKind = selectedControl?.dataSourceKind || inferReferenceSourceKind(selectedField, selectedEffectiveControlType);
  const selectedReferenceConfig = getReferenceConfig(selectedReferenceSourceKind);
  const selectedControlUsesEncoding = Boolean(
    selectedControl && (selectedEffectiveControlType === 'code' || isEncodingField(selectedField)),
  );
  const [optionCatalog,setOptionCatalog]=useState<{dictionaries:Array<{code:string;name:string}>;externalApis:Array<{id:number;name:string}>}>({dictionaries:[],externalApis:[]});
  const [testingOptionSource,setTestingOptionSource]=useState(false);
  useEffect(()=>{getFormOptionSources().then(response=>setOptionCatalog(response.data.data)).catch(()=>message.error('字典与 API 数据源列表加载失败，请刷新重试'));},[]);
  const [referenceForms,setReferenceForms]=useState<PlatformForm[]>([]);
  const [referenceLabelOptions,setReferenceLabelOptions]=useState<Array<{value:string;label:string}>>([]);
  useEffect(()=>{listPlatformForms().then(res=>setReferenceForms(res.data?.data||[])).catch(()=>{});},[]);
  useEffect(()=>{
    let cancelled=false;
    setReferenceLabelOptions(selectedReferenceConfig.labelFields);
    if(selectedReferenceSourceKind==='businessForm'&&selectedControl?.optionSource){
      getPlatformFormByCode(selectedControl.optionSource,{schema:'published',scope:'designer'}).then(res=>{
        if(!cancelled){const options=(res.data?.data?.fields||[]).filter((field:PlatformFormField)=>!field.archived).map((field:PlatformFormField)=>({value:field.field_name,label:field.label}));setReferenceLabelOptions(options);if(options.length&&!selectedControl.referenceLabelField)updateSelectedControl({referenceLabelField:options[0].value});}
      }).catch(()=>{if(!cancelled)setReferenceLabelOptions([]);});
    }
    return()=>{cancelled=true;};
  },[selectedReferenceSourceKind,selectedControl?.optionSource]);

  const assignmentSourceAttributeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'self.value', label: '本字段值' },
    ];
    const businessType = getFieldBusinessType(selectedField);
    const canReadOptionParts = selectedControlUsesDataSource || businessType === 'enum';
    if (canReadOptionParts) {
      options.push(
        { value: 'self.option_value', label: '选项值' },
        { value: 'self.option_label', label: '选项文本' },
      );
    }
    if (selectedControlUsesDataSource && selectedReferenceSourceKind !== 'static') {
      [{value:'id',label:'记录 ID'}, ...referenceLabelOptions].forEach((field) => {
        const value = `record.${field.value}`;
        if (!options.some((item) => item.value === value)) {
          options.push({ value, label: `关联记录.${field.label}` });
        }
      });
    }
    return options;
  }, [selectedControlUsesDataSource, selectedField, selectedReferenceConfig, selectedReferenceSourceKind, referenceLabelOptions]);
  const assignmentTargetFieldOptions = useMemo(() => (
    baseConfig.fields
      .filter((field) => field.key !== selectedField?.key)
      .map((field) => ({ value: field.key, label: field.name }))
  ), [baseConfig.fields, selectedField]);
  const selectedEncodingRule = selectedControlUsesEncoding
    ? selectedControl?.encodingRule || makeEncodingRule(selectedField)
    : undefined;
  const selectedEncodingSegments = useMemo(
    () => getEncodingSegments(encodingSettingsDraft || selectedEncodingRule),
    [selectedEncodingRule, encodingSettingsDraft],
  );
  const normalizedLibrarySearch = librarySearch.trim().toLowerCase();
  const matchesLibrarySearch = (text: string) => !normalizedLibrarySearch || text.toLowerCase().includes(normalizedLibrarySearch);
  const filteredCommonControls = commonControls.filter((item) => matchesLibrarySearch(`${item.name} ${item.desc} ${item.category}`));
  const filteredComponentGroups = componentGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesLibrarySearch(`${group.category} ${item.name} ${item.desc}`)),
    }))
    .filter((group) => !normalizedLibrarySearch || group.items.length > 0 || matchesLibrarySearch(group.category));
  const filteredFields = baseConfig.fields.filter((field) => matchesLibrarySearch(`${field.name} ${field.key} ${field.type} ${field.optionSource || ''}`));
  const libraryFields = baseConfig.fields;
  const filteredLibraryFields = filteredFields;
  const fallbackBusinessSections = baseConfig.id === 'alert-center' ? alertBusinessSections : [
    { key: 'default', title: '基础信息', desc: '当前表单的主要录入字段', fieldKeys: baseConfig.fields.map((field) => field.key) },
  ];
  const alertSections = normalizeBusinessSections(designerMeta.businessSections, fallbackBusinessSections);
  const hiddenRequiredControls = layoutControls.filter((control) => !control.rules.visible.enabled && control.rules.required.enabled);
  const updateSelectedControlRule = (ruleKey: ControlRuleKey, patch: Partial<ControlRule>) => {
    if (!selectedControl) return;
    const normalizedRules = normalizeControlRules(selectedControl.rules, selectedField);
    const currentRule = normalizedRules[ruleKey];
    updateSelectedControl({
      rules: {
        ...normalizedRules,
        [ruleKey]: {
          ...currentRule,
          ...patch,
          conditions: patch.conditions === undefined ? currentRule.conditions : patch.conditions,
        },
      },
    });
  };

  const updateSelectedRuleCondition = (ruleKey: ControlRuleKey, patch: Partial<ControlRuleCondition>) => {
    if (!selectedControl) return;
    updateSelectedControlRule(ruleKey, {
      conditions: {
        ...(normalizeControlRules(selectedControl.rules, selectedField)[ruleKey].conditions || {}),
        ...patch,
      },
    });
  };

  const getRuleConditionGroups = (rule: ControlRule): ControlRuleCondition[][] => {
    if (Array.isArray(rule.conditionGroups) && rule.conditionGroups.length) {
      return rule.conditionGroups.map((group) => (Array.isArray(group) && group.length ? group : [{}]));
    }
    return rule.conditions?.sourceField ? [[{sourceField:rule.conditions.sourceField,operator:rule.conditions.operator,value:rule.conditions.value}]] : [];
  };

  const getRuleGroupTitle = (rule: ControlRule, groupIndex: number) => {
    const title = rule.conditionGroupTitles?.[groupIndex]?.trim();
    return title || `条件组 ${groupIndex + 1}`;
  };

  const updateSelectedRuleConditionGroups = (
    ruleKey: ControlRuleKey,
    groups: ControlRuleCondition[][],
    titles = activeRule?.conditionGroupTitles || [],
  ) => {
    const normalizedGroups = groups
      .map((group) => group.filter(Boolean))
      .filter((group) => group.length);
    updateSelectedControlRule(ruleKey, {
      conditionGroups: normalizedGroups,
      conditionGroupTitles: titles.slice(0, normalizedGroups.length),
      conditions: { ...normalizeControlRules(selectedControl?.rules,selectedField)[ruleKey].conditions, sourceField:undefined,operator:undefined,value:undefined,...normalizedGroups[0]?.[0] },
    });
  };

  const addSelectedRuleConditionGroup = (ruleKey: ControlRuleKey) => {
    if (!activeRule) return;
    updateSelectedRuleConditionGroups(ruleKey, [...getRuleConditionGroups(activeRule), [{}]], activeRule.conditionGroupTitles || []);
  };

  const addSelectedRuleConditionRow = (ruleKey: ControlRuleKey, groupIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    groups[groupIndex] = [...(groups[groupIndex] || []), {}];
    updateSelectedRuleConditionGroups(ruleKey, groups);
  };

  const updateSelectedRuleConditionRow = (
    ruleKey: ControlRuleKey,
    groupIndex: number,
    rowIndex: number,
    patch: Partial<ControlRuleCondition>,
  ) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    const group = groups[groupIndex] || [{}];
    group[rowIndex] = { ...(group[rowIndex] || {}), ...patch };
    groups[groupIndex] = group;
    updateSelectedRuleConditionGroups(ruleKey, groups);
  };

  const removeSelectedRuleConditionRow = (ruleKey: ControlRuleKey, groupIndex: number, rowIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    const titles = [...(activeRule.conditionGroupTitles || [])];
    const group = (groups[groupIndex] || []).filter((_condition, index) => index !== rowIndex);
    if (group.length) {
      groups[groupIndex] = group;
    } else {
      groups.splice(groupIndex, 1);
      titles.splice(groupIndex, 1);
    }
    updateSelectedRuleConditionGroups(ruleKey, groups, titles);
  };

  const removeSelectedRuleConditionGroup = (ruleKey: ControlRuleKey, groupIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule).filter((_group, index) => index !== groupIndex);
    const titles = (activeRule.conditionGroupTitles || []).filter((_title, index) => index !== groupIndex);
    updateSelectedRuleConditionGroups(ruleKey, groups, titles);
  };

  const updateSelectedRuleGroupTitle = (ruleKey: ControlRuleKey, groupIndex: number, title: string) => {
    if (!activeRule) return;
    const titles = [...(activeRule.conditionGroupTitles || [])];
    titles[groupIndex] = title.trim();
    updateSelectedControlRule(ruleKey, { conditionGroupTitles: titles });
  };

  const controlRuleToggle = (ruleKey: ControlRuleKey) => {
    if (!selectedControl) return null;
    const rule = normalizeControlRules(selectedControl.rules, selectedField)[ruleKey];
    const title = ruleLabels[ruleKey];
    return (
      <RuleToggleControl
        enabled={rule.enabled}
        onConfig={() => {ruleOpeningValue.current={id:selectedControl.id,key:ruleKey,value:structuredClone(rule)};setRuleModal({ controlId: selectedControl.id, ruleKey });}}
        onToggle={() => updateSelectedControlRule(ruleKey, { enabled: !rule.enabled })}
        title={title}
      />
    );
  };

  const openSearchSettings = async () => {
    if (!selectedControl?.fieldKey) return;
    const epoch = ++searchRequestEpoch.current;
    const settings: OptionSearchSettings = structuredClone(selectedControl.typeSettings?.search || { fields: [], match: 'contains', filters: [] });
    setSearchDraft({ controlId: selectedControl.id, settings, query: '', metaLoading: true, loading: false, error: '', rows: [], page: 1, hasMore: false, context: {} });
    try {
      const schema: OptionSearchSchema = selectedReferenceSourceKind === 'static'
        ? { kind: 'static', fields: [{value:'label',label:'选项文字'}], defaultField:'label' }
        : (await previewOptionSearchSchema(platformForm!.id, selectedControl.fieldKey, layoutControls)).data.data;
      if (epoch !== searchRequestEpoch.current) return;
      setSearchDraft(current => current && ({ ...current, schema, metaLoading: false, settings: { ...current.settings, fields: current.settings.fields?.length ? current.settings.fields : [schema.defaultField] } }));
    } catch (error: any) {
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, metaLoading: false, error: error?.response?.data?.detail || '无法读取来源字段，请先检查数据来源' }));
    }
  };
  const updateSearchSettings = (patch: Partial<OptionSearchSettings>) => {
    ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, settings: { ...current.settings, ...patch }, rows: [], hasMore: false, tested: false, error: '', loading: false }));
  };
  const searchSettingsError = (draft: SearchSettingsDraft) => {
    const names = new Set(draft.schema?.fields.map(field => field.value));
    if (!draft.settings.fields?.length || draft.settings.fields.some(field => !names.has(field))) return '请选择有效的搜索字段';
    for (const filter of draft.settings.filters || []) {
      if (!names.has(filter.field)) return '请选择有效的范围字段';
      if (['isEmpty','notEmpty'].includes(filter.operator)) continue;
      if (filter.source === 'field' ? !baseConfig.fields.some(field => field.key === filter.sourceField) : !filter.value?.trim()) return '请完善候选范围的条件取值';
    }
    return '';
  };
  const updateSearchSample = (patch: Partial<SearchSettingsDraft>) => {
    ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, ...patch, rows: [], hasMore: false, tested: false, loading: false, error: '' }));
  };
  const testOptionSearch = async (page = 1) => {
    if (!searchDraft?.schema || !selectedControl?.fieldKey || searchDraft.controlId !== selectedControl.id) return;
    const invalid = searchSettingsError(searchDraft);
    if (invalid) { setSearchDraft(current => current && ({ ...current, error: invalid })); return; }
    const draft = searchDraft, epoch = ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, loading: true, error: '' }));
    try {
      let result: {data: SearchSettingsDraft['rows']; has_more: boolean};
      if (draft.schema?.kind === 'static') {
        const values = enumOptions(selectedControl.optionSource ? optionSourceToOptions(selectedControl.optionSource) : selectedField?.enumValues);
        const options = values.filter(option => matchesOptionSearch(option.label, draft.query, draft.settings.match));
        result = { data: options.slice((page-1)*20,page*20).map(option => ({id:option.value,label:option.label,matchedFields:draft.query?['label']:[]})), has_more: options.length > page*20 };
      } else {
        const controls = layoutControls.map(control => control.id === draft.controlId ? { ...control, typeSettings: { ...control.typeSettings, search: draft.settings } } : control);
        result = (await previewFormReferenceOptions(platformForm!.id, selectedControl.fieldKey, controls, draft.context, {query:draft.query,page,page_size:20})).data;
      }
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, rows: page===1?result.data:[...current.rows,...result.data], hasMore:result.has_more, page, loading:false, tested:true }));
    } catch (error:any) {
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, loading:false, error:error?.response?.data?.detail || '试搜失败，请检查来源与范围条件' }));
    }
  };
  const applySearchSettings = () => {
    if (!searchDraft || !selectedControl || searchDraft.controlId !== selectedControl.id) return;
    const invalid = searchSettingsError(searchDraft);
    if (invalid) { setSearchDraft(current => current && ({ ...current,error:invalid })); return; }
    updateSelectedControl({ typeSettings: { ...selectedControl.typeSettings, search: searchDraft.settings } });
    ++searchRequestEpoch.current; setSearchDraft(null);
  };

  const applyAssignmentDraft = () => {
    if (!assignmentDraft || assignmentDraft.controlId !== selectedControlId) return;
    const targets = new Set<string>();
    for (const rule of assignmentDraft.rules) {
      if (!assignmentSourceAttributeOptions.some(option => option.value === rule.sourceAttribute) || !assignmentTargetFieldOptions.some(option => option.value === rule.targetField)) { message.error('请选择有效的来源属性和目标字段'); return; }
      if (targets.has(rule.targetField!)) { message.error('同一目标字段不能重复赋值'); return; }
      targets.add(rule.targetField!);
    }
    updateSelectedControl({ assignmentRules: assignmentDraft.rules, assignmentRulesEnabled: true });
    setAssignmentDraft(null);
  };

  const applyDefaultValueDraft = () => {
    if (!defaultValueDraft || !selectedControl || defaultValueDraft.controlId !== selectedControl.id || !selectedField) return;
    const errors = defaultRuleErrors(layoutControls.map(control => control.id === selectedControl.id ? { ...control, defaultRule: { ...defaultValueDraft.rule, enabled: true } } : control), baseConfig.fields);
    if (errors.length) { message.error(errors.join('；')); return; }
    updateSelectedControl({ defaultRule: { ...defaultValueDraft.rule, enabled: true } });
    updateFieldDefaultValue(selectedField, defaultValueDraft.rule.mode === 'fixed' ? defaultValueDraft.fixed : '');
    setDefaultValueDraft(null);
  };

  const closeCalculationEditor = () => {
    calculationEpoch.current += 1;
    setCalculationDraft(null); setCalculationError(''); setCalculationResult(null); setCalculationBusy(false);
  };
  const updateCalculationDraft = (patch: Partial<CalculationRule>, samples?: Record<string, unknown>) => {
    calculationEpoch.current += 1;
    setCalculationBusy(false); setCalculationError(''); setCalculationResult(null);
    setCalculationDraft(current => current && ({ ...current, rule: { ...current.rule, ...patch }, samples: samples ?? current.samples }));
  };
  const calculationControls = () => layoutControls.map(control => control.id === calculationDraft?.controlId
    ? { ...control, computed: calculationDraft.rule, calculationRulesEnabled: true, inactiveCalculationRule: undefined, typeSettings: { ...control.typeSettings, precision: calculationDraft.rule.precision ?? undefined }, defaultRule: { ...(control.defaultRule || { mode: 'fixed' as const }), enabled: false } }
    : control);
  const checkCalculation = async (save: boolean) => {
    if (!calculationDraft || !platformForm) return;
    if (!calculationDraft.rule.expression.trim()) { setCalculationError('请填写计算公式'); return; }
    const epoch = ++calculationEpoch.current;
    setCalculationBusy(true); setCalculationError('');
    try {
      const controls = calculationControls();
      const response = await previewDesignerRules(platformForm.id, controls, calculationDraft.samples, false, save);
      if (epoch !== calculationEpoch.current) return;
      const target = controls.find(control => control.id === calculationDraft.controlId);
      if (!target?.fieldKey) return;
      if (save) {
        commitLayoutChange(() => controls);
        closeCalculationEditor();
      } else setCalculationResult({ value: response.data?.data?.data?.[target.fieldKey] });
    } catch (error: any) {
      if (epoch === calculationEpoch.current) setCalculationError(error?.response?.data?.detail || '公式检查失败，请稍后重试');
    } finally { if (epoch === calculationEpoch.current) setCalculationBusy(false); }
  };

  const markUnsaved = () => setHasUnsavedChanges(true);

  const updateFormAppearance = (patch: Partial<FormAppearance>) => {
    setFormAppearance(current => ({ ...current, ...patch }));
    markUnsaved();
  };

  const ensurePlatformForm = async () => {
    if (platformForm) return platformForm;
    if (aiFormDraft) throw new Error('请先确认创建草稿');
    const matchedForm = await resolvePlatformFormForConfig(staticBaseConfig.id);
    if (matchedForm) {
      setPlatformForm(matchedForm);
      setPermissionDrafts(permissionDraftsFromConfig(matchedForm.config));
      setWorkflowMeta(getWorkflowDesignerMeta(matchedForm));
      return matchedForm;
    }

    throw new Error('找不到对应的业务表单，请从业务数据重新打开');
  };

  const initialFieldPayloads = () => baseConfig.fields.map((baseField, index) => {
    const control = layoutControls.find(item => item.fieldKey === baseField.key);
    const field = control ? { ...baseField, name: control.name, required: control.rules.required.enabled, placeholder: control.placeholder ?? baseField.placeholder } : baseField;
    return {
      field_name: field.key,
      label: field.name,
      field_type: mapDesignerFieldType(field),
      business_type: getFieldBusinessType(field),
      control_type: inferFieldControlType(field),
      data_source: field.optionSource,
      encoding_rule: control?.encodingRule || (isEncodingField(field) ? field.encodingRule || makeEncodingRule(field) : undefined),
      required: Boolean(field.required),
      visible_in_list: field.listVisible !== false,
      visible_in_form: true,
      searchable: Boolean(field.searchable),
      sortable: Boolean(field.sortable),
      default_value: getDesignerFieldDefaultValue(field),
      enum_values: control?.optionSource && enumOptions(control.optionSource).length ? { values: enumOptions(control.optionSource) } : field.enumValues as Record<string, unknown> | undefined || (field.optionSource ? { source: field.optionSource } : undefined),
      validation: field.validation ? { message: field.validation } : undefined,
      ui_config: {
        placeholder: field.placeholder,
        locked: Boolean(field.locked),
        designerType: field.type,
        businessType: getFieldBusinessType(field),
        controlType: inferFieldControlType(field),
      },
      sort_order: index,
    };
  });

  const getDesignerFieldDefaultValue = (field: DesignerField) => (
    fieldDefaultValueDrafts[field.key] ?? field.defaultValue
  );

  const syncFieldDefaultValues = async (form: PlatformForm) => {
    const changedKeys = Object.keys(fieldDefaultValueDrafts);
    if (!changedKeys.length) return form;
    const fieldByName = new Map((form.fields || []).map((field) => [field.field_name, field]));
    await Promise.all(changedKeys.map(async (fieldKey) => {
      const platformField = fieldByName.get(fieldKey);
      if (!platformField) return;
      await updatePlatformFormField(form.id, platformField.id, {
        default_value: fieldDefaultValueDrafts[fieldKey],
      });
    }));
  };

  const savePermissionDesign = async () => {
    setPersistingPermissions(true);
    try {await saveDraft();}
    finally{setPersistingPermissions(false);}
  };

  const updateFormWorkflowMeta = async (form: PlatformForm, nextMeta: WorkflowDesignerMeta) => {
    const nextConfig = { ...(form.config || {}), workflowDesigner: nextMeta };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    setPlatformForm(updatedForm);
    setWorkflowMeta(nextMeta);
    return updatedForm;
  };

  const updateFormViewConfig = async (
    form: PlatformForm,
    nextViewConfig: ViewConfig,
    mode: 'draft' | 'published',
  ) => {
    const currentConfig = { ...(form.config || {}) } as Record<string, unknown>;
    const currentMeta = getViewConfigMeta(form);
    const now = new Date().toISOString();
    const draftVersion = Number(currentMeta.draftVersion || currentMeta.publishedVersion || 0);
    const publishedVersion = Number(currentMeta.publishedVersion || 0);
    const runtimeFormLayout = makeRuntimeFormLayout(layoutControls, baseConfig.fields);
    const nextMeta: ViewConfigMeta = mode === 'draft'
      ? {
          ...currentMeta,
          draftVersion: draftVersion + 1,
          draftSavedAt: now,
          status: 'draft',
        }
      : {
          ...currentMeta,
          draftVersion: Math.max(draftVersion, publishedVersion + 1),
          publishedVersion: publishedVersion + 1,
          draftSavedAt: now,
          publishedAt: now,
          status: 'published',
        };
    const nextConfig: Record<string, unknown> = mode === 'draft'
      ? {
          ...currentConfig,
          viewConfigDraft: nextViewConfig,
          formLayout: runtimeFormLayout,
          permissionDesignDraft:{version:1,roles:Object.fromEntries(Object.entries(permissionDrafts).map(([key,value])=>[key,sanitizePermissionDesignDraft(value)]))},
          formDesignerControls: layoutControls,
          canvasSettings,
          formAppearance: savedAppearance,
          viewConfigMeta: nextMeta,
        }
      : {
          ...currentConfig,
          viewConfig: nextViewConfig,
          viewConfigDraft: nextViewConfig,
          formLayout: runtimeFormLayout,
          permissionDesignDraft:{version:1,roles:Object.fromEntries(Object.entries(permissionDrafts).map(([key,value])=>[key,sanitizePermissionDesignDraft(value)]))},
          formDesignerControls: layoutControls,
          canvasSettings,
          formAppearance: savedAppearance,
          viewConfigMeta: nextMeta,
        };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    await upsertPlatformFormLayout(form.id, 'view', {
      layout_type: 'view',
      config: {
        draft: nextConfig.viewConfigDraft,
        published: nextConfig.viewConfig,
        meta: nextConfig.viewConfigMeta,
      },
    });
    await upsertPlatformFormLayout(form.id, 'form', {
      layout_type: 'form',
      config: runtimeFormLayout,
    });
    setPlatformForm(updatedForm);
    return updatedForm;
  };

  const updateFormAnalyticsDesign = async (
    form: PlatformForm,
    nextAnalyticsDesign: AnalyticsDesign,
    mode: 'draft' | 'published',
  ) => {
    const currentConfig = { ...(form.config || {}) } as Record<string, unknown>;
    const now = new Date().toISOString();
    const currentMeta = (currentConfig.analyticsDesignMeta || {}) as Record<string, unknown>;
    const draftVersion = Number(currentMeta.draftVersion || currentMeta.publishedVersion || 0);
    const publishedVersion = Number(currentMeta.publishedVersion || 0);
    const nextMeta = mode === 'draft'
      ? {
          ...currentMeta,
          draftVersion: draftVersion + 1,
          draftSavedAt: now,
          status: 'draft',
        }
      : {
          ...currentMeta,
          draftVersion: Math.max(draftVersion, publishedVersion + 1),
          publishedVersion: publishedVersion + 1,
          draftSavedAt: now,
          publishedAt: now,
          status: 'published',
        };
    const nextConfig: Record<string, unknown> = mode === 'draft'
      ? {
          ...currentConfig,
          assemblyKind: 'analysis',
          analyticsDesignDraft: nextAnalyticsDesign,
          analyticsDesignMeta: nextMeta,
        }
      : {
          ...currentConfig,
          assemblyKind: 'analysis',
          analyticsDesign: nextAnalyticsDesign,
          analyticsDesignDraft: nextAnalyticsDesign,
          analyticsDesignMeta: nextMeta,
        };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    await upsertPlatformFormLayout(form.id, 'analytics', {
      layout_type: 'analytics',
      config: {
        draft: nextConfig.analyticsDesignDraft,
        published: nextConfig.analyticsDesign,
        meta: nextConfig.analyticsDesignMeta,
      },
    });
    setPlatformForm(updatedForm);
    return updatedForm;
  };

  const workflowDefinitionPayload = (status: 'draft' | 'published', form: { id?: number; code: string }) => ({
    name: professionalFlowConfig.name || `${baseConfig.name}流程`,
    description: `${baseConfig.name} 表单内嵌流程设计`,
    status,
    config: makeWorkflowConfigPayload(professionalFlowConfig, form, baseConfig),
    form_config: makeWorkflowFormConfig(baseConfig),
  });

  const saveWorkflowDefinition = async (status: 'draft' | 'published', form: PlatformForm, workflowId?: number) => {
    const payload = workflowDefinitionPayload(status, form);
    if (workflowId) {
      const response = await wfUpdateDefinition(workflowId, payload);
      return {
        id: workflowId,
        version: Number(response.data?.version || 1),
        status: String(response.data?.status || status),
      };
    }
    const response = await wfCreateDefinition(payload);
    return {
      id: Number(response.data?.id),
      version: Number(response.data?.version || 1),
      status: String(response.data?.status || status),
    };
  };

  const persistDesignerDraft = async () => {
    if (aiFormDraft && !platformForm) {
      const response = await createPlatformForm({
        name: baseConfig.name,
        code: baseConfig.id,
        description: baseConfig.description,
        storage_mode: 'dynamic',
        status: 'draft',
        config: {
          source: 'form-settings',
          permissionDesignDraft: { version: 1, roles: Object.fromEntries(
            Object.entries(permissionDrafts).map(([key, value]) => [key, sanitizePermissionDesignDraft(value)]),
          ) },
          formDesignerControls: layoutControls,
          canvasSettings,
          formAppearance: savedAppearance,
        },
        designer_draft: {
          draft_id: aiFormDraft.id,
          fields: initialFieldPayloads(),
          layout: makeRuntimeFormLayout(layoutControls, baseConfig.fields),
          view: storedViewConfig,
          workflow: workflowDefinitionPayload('draft', { code: baseConfig.id }),
        },
      });
      const saved = response.data.data as PlatformForm;
      setPlatformForm(saved);
      setWorkflowMeta(getWorkflowDesignerMeta(saved));
      lastSavedForm.current = saved;
      setHasUnsavedChanges(false);
      return saved;
    }
    const form = await ensurePlatformForm();
    await syncFieldDefaultValues(form);
    const formWithView = await updateFormViewConfig(form, storedViewConfig, 'draft');
    let updatedForm: PlatformForm;
    if (isAnalysisDesigner) {
      updatedForm = await updateFormAnalyticsDesign(formWithView, analyticsDesign, 'draft');
    } else {
      const meta = getWorkflowDesignerMeta(formWithView);
      const saved = await saveWorkflowDefinition('draft', formWithView, meta.draftWorkflowId === meta.publishedWorkflowId ? undefined : meta.draftWorkflowId);
      updatedForm = await updateFormWorkflowMeta(formWithView, { ...meta, draftWorkflowId: saved.id });
    }
    lastSavedForm.current = updatedForm;
    setHasUnsavedChanges(false);
    return updatedForm;
  };

  const checkSelectionConfiguration = () => {
    const errors: string[] = [];
    for (const control of layoutControls) {
      const field = baseConfig.fields.find(item => item.key === control.fieldKey);
      const kind = getEffectiveControlTypeForControl(control, field);
      if (!['select', 'relation'].includes(kind)) continue;
      const sourceKind = control.dataSourceKind || inferReferenceSourceKind(field, kind);
      const settings = control.typeSettings || {};
      if (sourceKind !== 'static') continue;
      const options = control.optionSource === field?.optionSource && field?.enumValues ? enumOptions(field.enumValues) : parseStaticOptions(control.optionSource, field?.enumValues);
      errors.push(...[...staticOptionErrors(options), ...selectionConfigErrors(settings, options.length)].map(error => `「${control.name}」${error}`));
      if (settings.displayMode === 'tags' && settings.selectionMode !== 'multiple') errors.push(`「${control.name}」标签展示需要多选模式`);
      if (settings.allowCreateOption && (settings.selectionMode !== 'multiple' || settings.displayMode === 'radio')) errors.push(`「${control.name}」当前模式不支持临时项`);
      const rule = control.defaultRule || field?.defaultRule;
      const fixed = getFieldDefaultValue(field);
      if (rule?.enabled !== false && rule?.mode !== 'template' && fixed !== '') {
        let values: unknown[] = [fixed];
        if (settings.selectionMode === 'multiple') { try { const parsed = JSON.parse(fixed); values = Array.isArray(parsed) ? parsed : [parsed]; } catch { values = [fixed]; } }
        const countError = selectionCountError(values, settings);
        if (countError) errors.push(`「${control.name}」默认值${countError}`);
        if (!settings.allowCreateOption && values.some(value => !options.some(option => String(option.value) === String(value)))) errors.push(`「${control.name}」默认值不在候选选项中`);
      }
    }
    if (errors.length) { Modal.error({ title: '请完善选择控件配置', content: <div>{errors.map((error, index) => <div key={index}>{error}</div>)}</div> }); return false; }
    return true;
  };

  const savingDraft = useRef(false);
  const saveDraft = async () => {
    if (isPersistingFlow || savingDraft.current || !checkSelectionConfiguration()) return false;
    if (flowLoadError) { message.error(flowLoadError); return false; }
    savingDraft.current = true;
    setPersistingFlow(true);
    try {
      await persistDesignerDraft();
      message.success('草稿已保存，发布后会同步到业务页面');
      return true;
    } catch (error) {
      console.error('workflow draft save failed', error);
      if (aiFormDraft && !platformForm) {
        const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
        const detail = response?.data?.detail;
        message.error(response?.status === 409 && typeof detail === 'string'
          ? detail : '草稿保存未完成。当前设计仍保留，可以使用原编码重试。');
      } else {
        message.error('草稿保存失败，请检查后端服务或登录状态');
      }
      return false;
    } finally {
      savingDraft.current = false;
      setPersistingFlow(false);
    }
  };

  const { onStatusChange: reportDraftStatus, saveRef: embeddedSaveRef } = embeddedDraftGuard ?? {};
  useLayoutEffect(() => {
    if (!embeddedSaveRef) return;
    embeddedSaveRef.current = saveDraft;
    return () => {
      if (embeddedSaveRef.current === saveDraft) embeddedSaveRef.current = null;
    };
  }, [embeddedSaveRef, saveDraft]);
  useLayoutEffect(() => {
    reportDraftStatus?.({ dirty: hasUnsavedChanges, saving: isPersistingFlow || isPersistingPermissions });
  }, [reportDraftStatus, hasUnsavedChanges, isPersistingFlow, isPersistingPermissions]);
  useLayoutEffect(() => () => reportDraftStatus?.({ dirty: false, saving: false }), [reportDraftStatus]);

  const publishConfig = async () => {
    if (isPersistingFlow || savingDraft.current || !checkSelectionConfiguration()) return false;
    if (flowLoadError) { message.error(flowLoadError); return false; }
    setPersistingFlow(true);
    try {
      const draft = await persistDesignerDraft();
      const workflowDraftId = isAnalysisDesigner ? undefined : getWorkflowDesignerMeta(draft).draftWorkflowId;
      const response = await publishPlatformForm(draft.id, workflowDraftId);
      const published = response.data.data;
      const config = (published.snapshot?.form as { config?: PlatformForm['config'] } | undefined)?.config;
      const refreshed = await getPlatformForm(draft.id, { schema: 'draft', scope: 'designer' }).catch(error => {
        console.warn('published form refresh failed', error);
        return null;
      });
      const nextForm = refreshed?.data.data ?? { ...draft, status: 'published', config: config ?? draft.config };
      setPlatformForm(nextForm);
      setWorkflowMeta(getWorkflowDesignerMeta(nextForm));
      setVersion(`v${published.version}`);
      setHasUnsavedChanges(false);
      onPublished?.();
      message.success(isAnalysisDesigner ? 'BI 看板配置已发布' : '表单字段、录入与审批配置已发布');
      return true;
    } catch (error) {
      console.error('form publish failed', error);
      const detail = (error as { response?: { data?: { detail?: string | { report?: PlatformFormPublishReport } } } }).response?.data?.detail;
      const blocking = typeof detail === 'object' ? detail?.report?.items.filter(item => item.level === 'blocking') : undefined;
      if (blocking?.length) {
        const first = blocking[0];
        const field = first.label || first.field_name;
        const remaining = blocking.length - 1;
        message.error(`发布失败，${field ? `「${field}」：` : ''}${first.detail}${remaining ? `，另有 ${remaining} 项校验未通过` : ''}`);
      } else {
        message.error(typeof detail === 'string' ? `发布失败，${detail}` : '发布失败，请重试');
      }
      return false;
    } finally {
      setPersistingFlow(false);
    }
  };

  const warnBeforeLeave = () => {
    const exit = onExit;
    if (!exit) {
      navigate('/studio/business-data');
      return;
    }
    if (isPersistingFlow) return;
    if (!hasUnsavedChanges) { exit(); return; }
    let savingBeforeExit = false;
    const confirmation = Modal.confirm({
      className: 'form-designer-dialog',
      title: '返回前，保留这次修改吗？',
      content: '保存为配置草稿后，可以下次继续编辑。发布前，业务页面仍使用当前版本。',
      okText: '保存草稿并返回',
      cancelText: '继续编辑',
      onOk: async () => {
        savingBeforeExit = true;
        confirmation.update({ cancelButtonProps: { disabled: true }, keyboard: false, maskClosable: false });
        if (!await saveDraft()) {
          savingBeforeExit = false;
          confirmation.update({ cancelButtonProps: { disabled: false }, keyboard: true });
          throw new Error('草稿保存失败，请重试');
        }
        exit();
      },
      footer: (_, { OkBtn, CancelBtn }) => <Space wrap>
        <Button type="text" danger disabled={savingBeforeExit} onClick={() => { if (savingBeforeExit) return; confirmation.destroy(); exit(); }}>放弃修改并返回</Button>
        <CancelBtn /><OkBtn />
      </Space>,
    });
  };

  useEffect(()=>{
    if(!requestExitRef)return;
    requestExitRef.current=warnBeforeLeave;
    return ()=>{requestExitRef.current=null;};
  },[requestExitRef,warnBeforeLeave]);

  const applyTwoColumnLayout = () => {
    commitLayoutChange((current) => current.map((control) => ({ ...control, width: 'half' })));
    message.success('已应用两列布局');
  };

  const applyCompactLayout = () => {
    commitLayoutChange((current) => current.map((control) => ({
      ...control,
      width: control.controlType === 'textarea' || control.controlType === 'upload' ? 'full' : 'quarter',
    })));
    message.success('已应用紧凑布局');
  };

  const applyBusinessSectionLayout = () => {
    const controls: LayoutControl[] = [];
    alertSections.forEach((section) => {
      controls.push({
        id: `section-${section.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: 'component',
        controlType: 'divider',
        name: section.title,
        desc: section.desc,
        width: 'full',
        rules: makeControlRules(),
      });
      section.fieldKeys
        .map((fieldKey) => baseConfig.fields.find((field) => field.key === fieldKey))
        .filter((field): field is DesignerField => Boolean(field))
        .forEach((field) => controls.push(makeFieldControl(field)));
    });
    commitLayoutChange(() => controls);
    setSelectedControlId(controls.find((control) => control.fieldKey)?.id || '');
    message.success('已按告警业务分组重新排版');
  };

  const batchUpdateVisibleControls = (patch: Partial<LayoutControl>) => {
    commitLayoutChange((current) => current.map((control) => (
      control.source === 'field' ? { ...control, ...patch } : control
    )));
  };

  const batchSetRequired = () => {
    commitLayoutChange((current) => current.map((control) => (
      control.source === 'field'
        ? { ...control, rules: { ...control.rules, required: { ...control.rules.required, enabled: true } } }
        : control
    )));
    message.success('已将画布中的字段批量设为必填');
  };

  const addTemplateField = (template: DesignerField) => {
    const field = { ...template, key: `${template.key}-${Date.now()}` };
    const control = makeFieldControl(field);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    message.success(`已添加常用字段模板：${template.name}`);
  };

  const redoLayoutChange = () => {
    setFuture((current) => {
      const nextState = current[current.length - 1];
      if (!nextState) return current;
      setHistory((previous) => [...previous.slice(-19), layoutControls]);
      setLayoutControls(nextState);
      setSelectedControlId('');
      message.success('已重做画布操作');
      return current.slice(0, -1);
    });
  };

  const startFlowNodeDrag = (event: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    if ((event.target as HTMLElement).closest('.flow-port')) return;
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.offsetWidth || 1;
    const scaleY = rect.height / canvas.offsetHeight || 1;
    draggingFlowNodeRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      scaleX,
      scaleY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveFlowNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = draggingFlowNodeRef.current;
    const canvas = flowCanvasRef.current;
    if (!dragState || !canvas) return;
    const nextX = dragState.originX + (event.clientX - dragState.startX) / dragState.scaleX;
    const nextY = dragState.originY + (event.clientY - dragState.startY) / dragState.scaleY;
    const maxX = Math.max(40, canvas.offsetWidth - FLOW_NODE_WIDTH - 24);
    const maxY = Math.max(60, canvas.offsetHeight - FLOW_NODE_HEIGHT - 24);
    setFlowNodes((current) => current.map((node) => (
      node.id === dragState.id
        ? { ...node, x: Math.min(Math.max(28, nextX), maxX), y: Math.min(Math.max(72, nextY), maxY) }
        : node
    )));
  };

  const stopFlowNodeDrag = () => {
    draggingFlowNodeRef.current = null;
  };

  const addFlowNode = (definition: FlowNodeDefinition) => {
    setFlowNodes((current) => {
      const node: FlowNode = {
        id: `flow-${definition.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: definition.name,
        role: definition.role,
        x: 300,
        y: 112,
      };
      const endIndex = current.findIndex((item) => item.role === 'end');
      const next = definition.role === 'end' || endIndex < 0
        ? [...current, node]
        : [...current.slice(0, endIndex), node, ...current.slice(endIndex)];
      const arranged = next.map((item, index) => ({ ...item, x: item.x || 300, y: 112 + index * 126 }));
      setFlowConnections(makeFlowConnections(arranged));
      setPendingFlowPort(null);
      return arranged;
    });
  };

  const handleFlowPortClick = (event: React.MouseEvent<HTMLElement>, node: FlowNode, side: FlowPortSide) => {
    event.stopPropagation();
    setPendingFlowPort((current) => {
      if (!current) return { nodeId: node.id, side };
      if (current.nodeId === node.id && current.side === side) return null;
      const nextConnection: FlowConnection = {
        id: `${current.nodeId}-${current.side}-${node.id}-${side}-${Date.now()}`,
        fromId: current.nodeId,
        fromSide: current.side,
        toId: node.id,
        toSide: side,
      };
      setFlowConnections((connections) => [
        ...connections.filter((connection) => !(connection.fromId === current.nodeId && connection.fromSide === current.side && connection.toId === node.id && connection.toSide === side)),
        nextConnection,
      ]);
      return null;
    });
  };

  const commitLayoutChange = (updater: (current: LayoutControl[]) => LayoutControl[]) => {
    setLayoutControls((current) => {
      const next = normalizeLayout(updater(current));
      setHistory((previous) => [...previous.slice(-19), current]);
      setFuture([]);
      markUnsaved();
      return next;
    });
  };

  const { registerPageController, setDesignerContext } = useAiWorkbench();
  const draftSaveSnapshot = useMemo(() => ({
    baseConfig, canvasSettings, formAppearance, fieldDefaultValueDrafts, layoutControls, permissionDrafts, professionalFlowConfig, storedViewConfig,
  }), [baseConfig, canvasSettings, formAppearance, fieldDefaultValueDrafts, layoutControls, permissionDrafts, professionalFlowConfig, storedViewConfig]);
  const [layoutReview, setLayoutReview] = useState<{ id: string; snapshot: typeof draftSaveSnapshot }>();
  const layoutReviewId = hasUnsavedChanges && layoutReview?.snapshot === draftSaveSnapshot ? layoutReview.id : undefined;
  const aiNativeState = useRef({ layoutControls, selectedControlId, platformForm, layoutReviewId, commitLayoutChange, saveDraft, onTabChange, fields: baseConfig.fields });
  aiNativeState.current = { layoutControls, selectedControlId, platformForm, layoutReviewId, commitLayoutChange, saveDraft, onTabChange, fields: baseConfig.fields };
  const [pageCallCompletion, setPageCallCompletion] = useState<{
    resolve: (state: Record<string, unknown>) => void;
    layoutOperationCount?: number;
    includeLayout: boolean;
    layoutReviewId?: string;
  } | null>(null);
  useEffect(() => {
    if (permissionOnly || (!platformForm?.id && !aiFormDraft) || isResolvingPlatformConfig || isAnalysisDesigner) return;
    return registerPageController(platformForm?.id || 0, async (action: PageAction) => {
      let current = aiNativeState.current;
      if (action.draft_id ? (current.platformForm || action.draft_id !== aiFormDraft?.id) : current.platformForm?.id !== action.form_id) throw new Error('当前设计器与目标表单不一致');
      if (action.action === 'confirm_draft') {
        if (!aiFormDraft || !await current.saveDraft()) throw new Error('草稿未保存，请检查页面提示后重试');
        return { form_id: lastSavedForm.current?.id, saved: true, published: false };
      }
      if (action.action === 'confirm_layout_draft') {
        if (!current.platformForm || current.layoutReviewId !== action.id) {
          throw new Error('当前草稿已变更，请重新复核布局后保存。');
        }
        if (!await current.saveDraft()) throw new Error('草稿保存未完成，请检查设计器提示后重试。');
        return { form_id: action.form_id, saved: true, published: false };
      }
      if (savingDraft.current) throw new Error('正在保存表单草稿，请保存完成后重试。');
      const operations = action.action === 'draft_new' ? action.draft?.layout_operations : action.layout_operations;
      if (action.action === 'configure_layout') {
        if (!operations?.length) throw new Error('未收到布局操作');
        let fields = current.fields;
        if (action.form_id && operations.some(operation => operation.op === 'move' && operation.field_name
          && !fields.some(field => field.key === operation.field_name) && !current.layoutControls.some(control => control.fieldKey === operation.field_name))) {
          const response = await getPlatformForm(action.form_id, { schema: 'draft', scope: 'designer' });
          fields = platformFieldsToDesignerFields(response.data?.data?.fields);
          current = aiNativeState.current;
          if (current.platformForm?.id !== action.form_id || savingDraft.current) throw new Error('表单已切换或正在保存，请重试。');
        }
        const fieldsByName = new Map(fields.map(field => [field.key, field]));
        const next = applyAiLayoutOperations(current.layoutControls, operations, makeAiLayoutControl, name => {
          const field = fieldsByName.get(name);
          return field ? makeFieldControl(field) : undefined;
        });
        if (!areDesignerFieldsSame(current.fields, fields)) {
          setDatabaseFieldsByForm(previous => ({ ...previous, [staticBaseConfig.id]: fields }));
        }
        current.commitLayoutChange(() => next);
      }
      if (action.action === 'draft_new') {
        if (!aiFormDraft || !action.draft?.fields.length) throw new Error('未收到完整的表单字段计划');
        const fields = action.draft.fields.map(draftFieldToDesignerField);
        const controls: LayoutControl[] = [];
        action.draft.fields.forEach((definition, index) => {
          const field = fields[index];
          const control = applyNativeFieldProperties(makeFieldControl(field), field, definition);
          controls.splice(Math.min(definition.position ?? controls.length, controls.length), 0, control);
        });
        const next = operations?.length ? applyAiLayoutOperations(controls, operations, makeAiLayoutControl) : controls;
        setDatabaseFieldsByForm(value => ({ ...value, [staticBaseConfig.id]: fields }));
        current.commitLayoutChange(() => next);
        setViewConfig(makeDesignerViewConfig({ ...baseConfig, fields }));
        setSelectedControlId(next.find(item => !item.parentId)?.id || '');
        setDraftReviewReady(true);
      }
      if (action.action === 'add_field' || action.action === 'set_field_properties') setDraftReviewReady(false);
      if (action.action === 'add_field') {
        if (!aiFormDraft || !action.field) throw new Error('只能向未创建的本地草稿逐步添加字段');
        if (current.fields.length >= 60) throw new Error('草稿已达到字段数量上限');
        if (current.fields.some(field => field.key === action.field!.field_name)) throw new Error('该字段已在草稿中');
        const field = draftFieldToDesignerField(action.field);
        const fields = [...current.fields, field];
        setDatabaseFieldsByForm(value => ({ ...value, [staticBaseConfig.id]: fields }));
        const addedControl = applyNativeFieldProperties(makeFieldControl(field), field, action.field);
        current.commitLayoutChange(controls => {
          const next = [...controls];
          next.splice(Math.min(action.field!.position ?? next.length, next.length), 0, addedControl);
          return next;
        });
        setViewConfig(makeDesignerViewConfig({ ...baseConfig, fields }));
        setSelectedControlId(addedControl.id);
      }
      if (action.action === 'review') setDraftReviewReady(true);
      const control = action.field_name ? current.layoutControls.find(item => item.fieldKey === action.field_name) : undefined;
      if (action.field_name && !control) throw new Error('该字段不在当前画布中，请先在原设计器加入已有字段');
      if (action.action === 'set_field_properties' && control) {
        const properties = action.properties || {};
        const field = current.fields.find(field => field.key === control.fieldKey);
        const updated = applyNativeFieldProperties(control, field, properties);
        current.commitLayoutChange(controls => {
          const next = controls.map(item => item.id === control.id ? updated : item);
          if (properties.position !== undefined) {
            const index = next.findIndex(item => item.id === control.id);
            const [moved] = next.splice(index, 1);
            next.splice(Math.min(properties.position, next.length), 0, moved);
          }
          return next;
        });
      }
      setActiveTab('form');
      current.onTabChange?.('form');
      if (control) setSelectedControlId(control.id);
      if (action.action === 'preview') setPreviewOpen(true);
      // Resolve only after React commits the native designer's changed state.
      return new Promise<Record<string, unknown>>(resolve => setPageCallCompletion({
        resolve, layoutOperationCount: operations?.length,
        includeLayout: action.action === 'inspect_layout' || Boolean(operations?.length),
        layoutReviewId: action.action === 'configure_layout' && action.form_id > 0 ? action.id : undefined,
      }));
    });
  }, [platformForm?.id, aiFormDraft, isResolvingPlatformConfig, isAnalysisDesigner, permissionOnly, registerPageController, baseConfig.fields]);
  useEffect(() => {
    if (!pageCallCompletion) return;
    const reviewId = hasUnsavedChanges ? pageCallCompletion.layoutReviewId : undefined;
    if (reviewId) setLayoutReview({ id: reviewId, snapshot: draftSaveSnapshot });
    const selected = layoutControls.find(control => control.id === selectedControlId);
    pageCallCompletion.resolve({ form_id: platformForm?.id || null, draft_id: platformForm ? undefined : aiFormDraft?.id,
      ...(reviewId && { layout_review_ready: true }),
      ...(pageCallCompletion.includeLayout && { layout_controls: describeAiLayout(layoutControls),
        unplaced_fields: baseConfig.fields.filter(field => !layoutControls.some(control => control.fieldKey === field.key))
          .map(field => ({ field_name: field.key, label: field.name })),
        layout_operation_count: pageCallCompletion.layoutOperationCount }),
      fields: layoutControls.filter(control => control.fieldKey).map(control => ({ field_name: control.fieldKey, label: control.name,
        control_type: getEffectiveControlTypeForControl(control, baseConfig.fields.find(field => field.key === control.fieldKey)),
        required: control.rules.required.enabled, readonly: control.rules.readonly.enabled })), selected_field: selected?.fieldKey,
      label: selected?.name, required: selected?.rules.required.enabled,
      readonly: selected?.rules.readonly.enabled, unsaved_changes: hasUnsavedChanges,
      review_ready: draftReviewReady, saved: false, published: false });
    setPageCallCompletion(null);
  }, [pageCallCompletion, layoutControls, selectedControlId, hasUnsavedChanges, platformForm?.id, aiFormDraft, draftReviewReady, baseConfig.fields, draftSaveSnapshot]);
  useEffect(() => {
    if ((!platformForm?.id && !aiFormDraft) || isResolvingPlatformConfig) return;
    setDesignerContext({ kind: baseConfig.kind, form_id: platformForm?.id || null, draft_id: platformForm ? undefined : aiFormDraft?.id, form_code: platformForm?.code || aiFormDraft?.code, form_name: baseConfig.name, review_ready: draftReviewReady, layout_review_id: layoutReviewId, unsaved_changes: hasUnsavedChanges,
      selected_field: layoutControls.find(control => control.id === selectedControlId)?.fieldKey,
      fields: layoutControls.filter(control => control.fieldKey).map(control => ({ field_name: control.fieldKey,
        label: control.name, required: control.rules.required.enabled, readonly: control.rules.readonly.enabled,
        min: control.typeSettings?.min, max: control.typeSettings?.max,
        control_type: getEffectiveControlTypeForControl(control, baseConfig.fields.find(field => field.key === control.fieldKey)),
        width: control.width, settings: control.typeSettings, presentation: control.presentation,
        options: enumOptions(control.optionSource), encoding: control.encodingRule ? { prefix: control.encodingRule.prefix, date_pattern: control.encodingRule.datePattern, sequence_length: control.encodingRule.sequenceLength, reset_cycle: control.encodingRule.resetCycle } : undefined })) });
  }, [platformForm?.id, aiFormDraft, draftReviewReady, baseConfig.kind, baseConfig.name, baseConfig.fields, isResolvingPlatformConfig, layoutControls, layoutReviewId, selectedControlId, hasUnsavedChanges, setDesignerContext]);
  useEffect(() => {
    if (aiFormDraft && platformForm?.id && !hasUnsavedChanges && !isPersistingFlow) {
      navigate(businessDataDesignPath(platformForm.id, 'form'), { replace: true });
    }
  }, [aiFormDraft, platformForm?.id, hasUnsavedChanges, isPersistingFlow, navigate]);
  useEffect(() => () => setDesignerContext(undefined), [setDesignerContext]);

  const undoLayoutChange = () => {
    setHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setFuture((next) => [...next.slice(-19), layoutControls]);
      setLayoutControls(previous);
      setSelectedControlId('');
      markUnsaved();
      message.success('已撤回上一步画布操作');
      return current.slice(0, -1);
    });
  };

  const addFieldToCanvas = (field: DesignerField) => {
    const control = makeFieldControl(field);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    setSelectedAssetKey(field.key);
  };

  const addComponentToCanvas = (component: ComponentDefinition) => {
    const control = makeComponentControl(component);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    message.success(`已添加${component.name}`);
  };

  const updateSelectedControl = (patch: Partial<LayoutControl>) => {
    if (!selectedControlId) return;
    commitLayoutChange((current) => current.map((control) => (
      control.id === selectedControlId ? { ...control, ...patch } : control
    )));
  };

  const addAssignmentRule = () => setAssignmentDraft(current => current && ({ ...current, rules: [...current.rules, { id: `assign-${createUuid()}`, sourceAttribute: assignmentSourceAttributeOptions[0]?.value || 'self.value' }] }));
  const updateAssignmentRule = (ruleId: string, patch: Partial<AssignmentRule>) => setAssignmentDraft(current => current && ({ ...current, rules: current.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule) }));
  const removeAssignmentRule = (ruleId: string) => setAssignmentDraft(current => current && ({ ...current, rules: current.rules.filter(rule => rule.id !== ruleId) }));

  const updateSelectedEncodingRule = (patch: Partial<EncodingRule>) => {
    if (!selectedControlId) return;
    const currentRule = selectedControl?.encodingRule || makeEncodingRule(selectedField);
    updateSelectedControl({ encodingRule: { ...currentRule, ...patch } });
  };

  const updateSelectedTypeSettings = (patch: Partial<ControlTypeSettings>) => {
    if (!selectedControl) return;
    const settings = { ...getDefaultTypeSettings(selectedEffectiveControlType, selectedField), ...(selectedControl.typeSettings || {}) };
    updateSelectedControl({ typeSettings: ['select', 'relation'].includes(selectedEffectiveControlType)
      ? normalizeSelection(settings, patch, selectedReferenceSourceKind === 'static') : { ...settings, ...patch } });
  };

  const syncEncodingSegments = (segments: EncodingSegment[]) => {
    const dependencies = Array.from(new Set(
      segments
        .filter((segment) => segment.type === 'field' || segment.type === 'masterData')
        .map((segment) => segment.sourceField)
        .filter(Boolean) as string[],
    ));
    const sequenceSegment = segments.find((segment) => segment.type === 'sequence');
    setEncodingSettingsDraft((current) => current ? ({
      ...current,
      segments,
      dependencies,
      sequenceLength: sequenceSegment?.length || selectedEncodingRule?.sequenceLength || 3,
      resetCycle: sequenceSegment?.resetCycle || selectedEncodingRule?.resetCycle || 'month',
      regenerateOnDependencyChange: segments.some((segment) => segment.regenerateOnChange),
    }) : current);
  };

  const openEncodingSegmentEditor = (segment?: EncodingSegment, index?: number, part: 'type' | 'length' | 'value' | 'padding' = 'type') => {
    setEncodingSegmentEditPart(part);
    const draft = segment ? { ...segment, name: segment.name || getEncodingSegmentTypeLabel(segment.type) } : makeEncodingSegment('fixed', baseConfig.fields);
    const targetIndex = typeof index === 'number' ? index : selectedEncodingSegments.length;
    if (!segment) syncEncodingSegments([...selectedEncodingSegments, draft]);
    setEncodingSegmentEditor({ open: true, index: targetIndex, draft });
  };

  const closeEncodingSegmentEditor = () => {
    setEncodingSegmentEditor((current) => ({ ...current, open: false }));
  };

  const updateEncodingSegmentDraft = (patch: Partial<EncodingSegment>) => {
    const draft = { ...encodingSegmentEditor.draft, ...patch };
    setEncodingSegmentEditor(current => ({ ...current, draft }));
    if (typeof encodingSegmentEditor.index === 'number') {
      syncEncodingSegments(selectedEncodingSegments.map((segment, index) => index === encodingSegmentEditor.index ? draft : segment));
    }
  };

  const saveEncodingSegmentDraft = () => {
    if (!selectedControlUsesEncoding || !selectedEncodingRule) return;
    const draft = encodingSegmentEditor.draft;
    if (!draft.name?.trim()) {
      message.warning('请填写编码段名称');
      return;
    }
    if (!draft.length || draft.length < 1) {
      message.warning('编码段位数至少为 1');
      return;
    }
    const nextSegments = [...selectedEncodingSegments];
    if (typeof encodingSegmentEditor.index === 'number') {
      nextSegments[encodingSegmentEditor.index] = draft;
    } else {
      nextSegments.push(draft);
    }
    syncEncodingSegments(nextSegments);
    closeEncodingSegmentEditor();
  };

  const dismissEncodingSettings = () => {
    closeEncodingSegmentEditor();
    setEncodingSettingsDraft(null);
    encodingRuleTargetRef.current = null;
  };

  const deleteEncodingSettings = () => {
    const target = encodingRuleTargetRef.current;
    if (!target || !encodingSettingsDraft) return;
    const rules = getEncodingRules(target.rule).filter(rule => rule.id !== encodingSettingsDraft.id);
    commitLayoutChange(controls => controls.map(control => control.id === target.controlId
      ? { ...control, encodingRule: { ...target.rule, enabled: rules.length > 0 && target.rule.enabled !== false, rules } }
      : control));
    dismissEncodingSettings();
  };

  const commitEncodingSettings = () => {
          if (!encodingSettingsDraft || !encodingSettingsDraft.name?.trim()) { message.warning('请填写规则名称'); return; }
          const invalidSegment = selectedEncodingSegments.find(segment => encodingSegmentLengthError(segment));
          if (invalidSegment) { message.warning(`${getEncodingSegmentTypeLabel(invalidSegment.type)}：${encodingSegmentLengthError(invalidSegment)}，请调整内容、位数或选择超长截断`); return; }
          if (encodingSettingsDraft.generationMode !== 'manual' && !selectedEncodingSegments.length) { message.warning('请添加编码段'); return; }
          if ((encodingSettingsDraft.conditions || []).some((c) => !c.sourceField || (!['isEmpty', 'notEmpty'].includes(c.operator || '') && !c.value?.trim()))) {
            message.warning('请完整填写触发条件'); return;
          }
          const target = encodingRuleTargetRef.current;
          if (!target) { message.warning('请重新打开编码规则配置'); return; }
          const rules = [...getEncodingRules(target.rule)];
          if (rules.some((r) => r.id !== encodingSettingsDraft.id && r.name?.trim() === encodingSettingsDraft.name?.trim())) {
            message.warning('规则名称不能重复'); return;
          }
          const { priority, ...savedRule } = encodingSettingsDraft;
          const existingIndex = rules.findIndex((rule) => rule.id === savedRule.id);
          const nextRules = [...rules];
          if (existingIndex >= 0) nextRules[existingIndex] = savedRule;
          else nextRules.push(savedRule);
          commitLayoutChange(controls => controls.map(control => control.id === target.controlId ? { ...control, encodingRule: { ...target.rule, rules: nextRules } } : control));
          dismissEncodingSettings();
  };

  const renderEncodingSegmentForm = () => {
    const draft = encodingSegmentEditor.draft;
    const update = updateEncodingSegmentDraft;
    return <div className="encoding-segment-cell-inputs" onDoubleClick={event => event.stopPropagation()}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && !(event.relatedTarget as HTMLElement)?.closest?.('.ant-select-dropdown')) closeEncodingSegmentEditor(); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') saveEncodingSegmentDraft(); }}>
      {draft.type === 'fixed' && <Input autoFocus size="small" aria-label="固定值" status={encodingSegmentLengthError(draft) ? 'error' : undefined} value={draft.value || ''} onChange={event => update({value:event.target.value})} />}
      {draft.type === 'date' && <Select autoFocus size="small" aria-label="日期格式" value={draft.datePattern || 'YYMM'} options={encodingDatePatternOptions} onChange={datePattern => update({datePattern,length:getDateSegmentLength(datePattern) || draft.length})} />}
      {(draft.type === 'field' || draft.type === 'masterData') && <Select autoFocus size="small" aria-label="依据字段" value={draft.sourceField} options={baseConfig.fields.filter(field => field.key !== selectedField?.key).map(field => ({value:field.key,label:field.name}))} onChange={sourceField => update({sourceField,regenerateOnChange:Boolean(sourceField)})} />}
      {(draft.type === 'field' || draft.type === 'masterData' || draft.type === 'organization') && <Select size="small" aria-label="取值属性" value={draft.sourceAttribute || (draft.type === 'organization' ? 'org_code' : 'code')} options={draft.type === 'organization' ? [{value:'org_code',label:'组织编码'},{value:'factory_code',label:'工厂编码'},{value:'department_code',label:'部门编码'},{value:'org_name',label:'组织简称'}] : [{value:'code',label:'编码'},{value:'id',label:'ID'},{value:'shortName',label:'简称'},{value:'custom',label:'自定义属性'}]} onChange={sourceAttribute => update({sourceAttribute})} />}
      {draft.type === 'sequence' && <><InputNumber autoFocus size="small" aria-label="起始值" min={0} value={draft.sequenceStart ?? 1} onChange={value => update({sequenceStart:Number(value ?? 1)})} /><InputNumber size="small" aria-label="步长" min={1} value={draft.sequenceStep || 1} onChange={value => update({sequenceStep:Number(value || 1)})} /><Select size="small" aria-label="重置周期" value={draft.resetCycle || 'month'} options={encodingResetCycleOptions} onChange={resetCycle => update({resetCycle})} /></>}
    </div>;
  };

  const renderEncodingSegmentContents = (segment: EncodingSegment, index: number) => {
    const editing = encodingSegmentEditor.open && encodingSegmentEditor.index === index;
    const draft = editing ? encodingSegmentEditor.draft : segment;
    const start = (part: 'type' | 'length' | 'value' | 'padding') => openEncodingSegmentEditor(segment,index,part);
    const value = segment.type === 'fixed' ? segment.value || '设置固定值'
      : segment.type === 'date' ? segment.datePattern || 'YYMM'
      : segment.type === 'sequence' ? `起始 ${segment.sequenceStart ?? 1} · 步长 ${segment.sequenceStep || 1} · ${encodingResetCycleOptions.find(option => option.value === (segment.resetCycle || 'month'))?.label || segment.resetCycle || '按月重置'}`
      : `${baseConfig.fields.find(field => field.key === segment.sourceField)?.name || segment.sourceField || segment.sourceAttribute || '选择来源'}${segment.sourceAttribute ? ` / ${segment.sourceAttribute}` : ''}`;
    const cellButton = (part: 'type' | 'length' | 'value' | 'padding', label: string, content: React.ReactNode) => <button type="button" className="encoding-cell-display" aria-label={label}
      onDoubleClick={event => { event.stopPropagation(); start(part); }}
      onClick={event => { event.stopPropagation(); if (event.detail === 0) start(part); }}>{content}</button>;
    return <div className="encoding-segment-description encoding-segment-property-row">
      <div className="encoding-property-cell encoding-property-type">
        {editing && encodingSegmentEditPart === 'type' ? <Select autoFocus size="small" aria-label="段类型" value={draft.type} options={encodingSegmentTypeOptions}
          onBlur={closeEncodingSegmentEditor} onChange={type => { updateEncodingSegmentDraft({...makeEncodingSegment(type, baseConfig.fields),id:draft.id}); closeEncodingSegmentEditor(); }} />
          : cellButton('type',`编辑编码段类型：${getEncodingSegmentTypeLabel(segment.type)}`,<strong>{segment.name || getEncodingSegmentTypeLabel(segment.type)}</strong>)}
      </div>
      <div className="encoding-property-cell encoding-property-length">
        {editing && encodingSegmentEditPart === 'length' ? <InputNumber autoFocus size="small" aria-label="位数" min={1} max={64} suffix="位" value={draft.length}
          onChange={length => updateEncodingSegmentDraft({length:Number(length || 1)})} onBlur={closeEncodingSegmentEditor} onPressEnter={closeEncodingSegmentEditor} />
          : cellButton('length',`编辑${getEncodingSegmentTypeLabel(segment.type)}位数`,<span>{segment.length} 位</span>)}
      </div>
      <div className="encoding-property-cell encoding-property-value">
        {editing && encodingSegmentEditPart === 'value' ? renderEncodingSegmentForm() : cellButton('value',`编辑${getEncodingSegmentTypeLabel(segment.type)}内容`,<code>{value}</code>)}
        {encodingSegmentLengthError(segment) && <span className="encoding-segment-error" role="alert">{encodingSegmentLengthError(segment)}</span>}
      </div>
      <div className="encoding-property-cell encoding-property-padding">
        {editing && encodingSegmentEditPart === 'padding' ? <Select autoFocus size="small" aria-label={`${getEncodingSegmentTypeLabel(segment.type)}补位方式`} value={draft.padding || (draft.type === 'sequence' ? 'leftZero' : 'none')} options={encodingPaddingOptions}
          onBlur={closeEncodingSegmentEditor} onChange={padding => { updateEncodingSegmentDraft({padding}); closeEncodingSegmentEditor(); }} />
          : cellButton('padding',`编辑${getEncodingSegmentTypeLabel(segment.type)}补位方式`,<span>{encodingPaddingOptions.find(option => option.value === (segment.padding || (segment.type === 'sequence' ? 'leftZero' : 'none')))?.label}</span>)}

      </div>
    </div>;
  };

  const removeEncodingSegment = (index: number) => {
    closeEncodingSegmentEditor();
    syncEncodingSegments(selectedEncodingSegments.filter((_, segmentIndex) => segmentIndex !== index));
  };

  const moveLayoutControl = (sourceId: string, targetId: string, position: DropPosition = 'before') => {
    const target = layoutControls.find(item => item.id === targetId);
    if (!target || layoutDescendants(layoutControls, sourceId).has(targetId)) return;
    commitLayoutChange(current => {
      const siblings = current.filter(item => item.parentId === target.parentId && item.slotId === target.slotId && item.id !== sourceId);
      const nextSibling = siblings[siblings.findIndex(item => item.id === targetId) + 1];
      return placeLayoutControl(current, sourceId, target.parentId, target.slotId, position === 'before' ? target.id : nextSibling?.id);
    });
    setSelectedControlId(sourceId);
  };
  const moveLayoutControlToEnd = (sourceId: string) => {
    commitLayoutChange(current => placeLayoutControl(current, sourceId));
    setSelectedControlId(sourceId);
  };

  const duplicateControl = (control?: LayoutControl | null) => {
    if (!control) return;
    const tree = cloneLayoutSubtree(layoutControls, control.id, () => `control-${createUuid()}`);
    const copied = tree.find(item => item.parentId === control.parentId) || tree[0];
    setCopiedControl(control); setCopiedTree(layoutControls.filter(item => layoutDescendants(layoutControls, control.id).has(item.id)));
    commitLayoutChange((current) => [...current, ...tree]);
    setSelectedControlId(copied.id);
  };

  const copyControlToClipboard = (control?: LayoutControl | null) => {
    if (!control) return;
    setCopiedControl(control); setCopiedTree(layoutControls.filter(item => layoutDescendants(layoutControls, control.id).has(item.id)));
    message.success('已复制控件，可使用 Ctrl+V 粘贴');
  };

  const pasteCopiedControl = () => {
    if (!copiedControl) {
      message.warning('还没有复制控件');
      return;
    }
    const tree = cloneLayoutSubtree(copiedTree.length ? copiedTree : [copiedControl], copiedControl.id, () => `control-${createUuid()}`);
    commitLayoutChange((current) => [...current, ...tree]);
    setSelectedControlId(tree.find(item => item.parentId === copiedControl.parentId)?.id || tree[0]?.id);
  };

  const removeControl = (controlId?: string) => {
    const targetId = controlId || selectedControlId;
    const target = layoutControls.find((control) => control.id === targetId);
    if (!target) {
      message.warning('请先选择画布控件');
      return;
    }
    commitLayoutChange((current) => unwrapLayoutControl(current, targetId));
    setSelectedControlId('');
    message.success(isLayoutContainer(target) ? '容器已移除，内部控件已移到上一级' : '已从画布移出控件，字段资产仍然保留');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'form' || isEditableTarget(event.target) || (event.target instanceof Element && event.target.closest('.ant-modal, .ant-drawer'))) return;
      const metaKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (metaKey && key === 'c') {
        event.preventDefault();
        copyControlToClipboard(selectedControl);
      }
      if (metaKey && key === 'v') {
        event.preventDefault();
        pasteCopiedControl();
      }
      if (metaKey && key === 'z') {
        event.preventDefault();
        undoLayoutChange();
      }
      if (metaKey && key === 'y') {
        event.preventDefault();
        redoLayoutChange();
      }
      if (!metaKey && (event.key === 'Delete' || event.key === 'Backspace') && selectedControl) {
        event.preventDefault();
        removeControl(selectedControl.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, copiedControl, copiedTree, selectedControl, selectedControlId, layoutControls]);

  const getCanvasControlDragProps = (control: LayoutControl) => ({
    tabIndex: 0,
    role: 'group',
    'aria-label': `编辑字段：${control.name}`,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      setSelectedControlId(control.id);
      setSelectedAssetKey(control.fieldKey || '');
    },
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.dataTransfer.setData('layoutControlId', control.id);
      event.dataTransfer.effectAllowed = 'move';
      setDraggedControlId(control.id);
      setCanvasDragActive(true);
      setSelectedControlId(control.id);
      if (control.fieldKey) setSelectedAssetKey(control.fieldKey);
    },
    onDragEnd: () => {
      setDraggedControlId('');
      setDropHint(null);
      setCanvasDragActive(false);
    },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const position: DropPosition = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
      setDropHint({ controlId: control.id, position });
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropHint((current) => (current?.controlId === control.id ? null : current));
      }
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = event.dataTransfer.getData('layoutControlId');
      if (sourceId) moveLayoutControl(sourceId, control.id, dropHint?.controlId === control.id ? dropHint.position : 'before');
      else {
        const field = baseConfig.fields.find(item => item.key === event.dataTransfer.getData('fieldKey'));
        const component = componentGroups.flatMap(group => group.items).find(item => item.key === event.dataTransfer.getData('componentKey'));
        const added = field ? makeFieldControl(field) : component ? makeComponentControl(component) : null;
        if (added) { commitLayoutChange(current => placeLayoutControl([...current, added], added.id, control.parentId, control.slotId, control.id)); setSelectedControlId(added.id); }
      }
      setDraggedControlId('');
      setDropHint(null);
      setCanvasDragActive(false);
    },
  });

  const handleContainerDrop=(event:React.DragEvent, parentId:string,slotId:string)=>{
    event.preventDefault();event.stopPropagation();
    let id=event.dataTransfer.getData('layoutControlId');
    const field=baseConfig.fields.find(f=>f.key===event.dataTransfer.getData('fieldKey'));
    const component=componentGroups.flatMap(g=>g.items).find(c=>c.key===event.dataTransfer.getData('componentKey'));
    const added=!id?(field?makeFieldControl(field):component?makeComponentControl(component):null):null;
    if(added)id=added.id;if(!id)return;
    commitLayoutChange(current=>placeLayoutControl(added?[...current,added]:current,id,parentId,slotId));
    setSelectedControlId(id);setCanvasDragActive(false);setDraggedControlId('');setDropHint(null);
  };

  const activeRule = ruleModal && selectedControl?.id === ruleModal.controlId
    ? normalizeControlRules(selectedControl.rules, selectedField)[ruleModal.ruleKey]
    : null;
  const activeRuleLabel = ruleModal ? ruleLabels[ruleModal.ruleKey] : '';
  const activeRuleStrategyOptions = ruleModal ? ruleStrategyOptions[ruleModal.ruleKey] || [] : [];
  const activeRuleConditionGroups = activeRule ? getRuleConditionGroups(activeRule) : [];
  const conditionFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: field.name }));
  const conditionFieldByKey = new Map(baseConfig.fields.map((field) => [field.key, field]));
  const renderRuleConditionValueControl = (
    condition: ControlRuleCondition,
    groupIndex: number,
    rowIndex: number,
  ) => {
    if (!ruleModal) return null;
    const sourceField = conditionFieldByKey.get(condition.sourceField || '');
    const businessType = getFieldBusinessType(sourceField);
    const updateValue = (value: unknown) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, {
      value: value === undefined || value === null ? '' : String(value),
    });
    if (businessType === 'number') {
      const numericValue = condition.value === undefined || condition.value === '' ? undefined : Number(condition.value);
      return (
        <InputNumber
          placeholder="条件值"
          value={Number.isFinite(numericValue) ? numericValue : undefined}
          onChange={updateValue}
          style={{ width: '100%' }}
        />
      );
    }
    if (businessType === 'enum' || businessType === 'person' || businessType === 'relation') {
      return (
        <Select
          allowClear
          placeholder="条件值"
          value={condition.value || undefined}
          onChange={updateValue}
          options={optionSourceToOptions(sourceField?.optionSource, sourceField?.placeholder)}
        />
      );
    }
    if (businessType === 'date' || businessType === 'datetime') {
      return (
        <Input
          placeholder={businessType === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'}
          prefix={<CalendarOutlined />}
          value={condition.value || ''}
          onChange={(event) => updateValue(event.target.value)}
        />
      );
    }
    return (
      <Input
        placeholder={sourceField ? '条件值' : '请先选择目标字段'}
        value={condition.value || ''}
        onChange={(event) => updateValue(event.target.value)}
      />
    );
  };
  const activePreviewRole = permissionRoles.includes(previewRole) ? previewRole : permissionRoles[0];
  const previewRoleRecord = identityRoleRecords.find(role => role.label === activePreviewRole || role.name === activePreviewRole);
  const previewRoleIndex = Math.max(permissionRoles.indexOf(activePreviewRole), 0);
  const previewRoleKind = previewRoleIndex === 0 ? 'system' : previewRoleIndex < 4 ? 'manager' : 'operator';
  const previewRoleDraft = permissionDrafts[activePreviewRole] || permissionDrafts[previewRoleRecord?.name || '']
    || permissionDraftsFromRows(formPermissionRows, identityRoleRecords, baseConfig.fields, permissionOrgUnitIds)[activePreviewRole]
    || makePermissionDesignDraft(previewRoleKind, permissionOrgUnitIds);
  const previewRoleCanView = previewRoleDraft.page.enter !== false && previewRoleDraft.actions.view !== false;
  const previewRoleCanFill = selectedPreviewFlowNode?.type === 'endEvent' ? false
    : previewRoleDraft.actions[selectedPreviewFlowNode && selectedPreviewFlowNode.type !== 'startEvent' ? 'approve' : 'create'] !== false;
  const getPreviewFieldPermission = (fieldKey?: string) => {
    if (!fieldKey) return undefined;
    const fieldIndex = baseConfig.fields.findIndex(field => field.key === fieldKey);
    const field = baseConfig.fields[fieldIndex];
    const rolePermission = field ? previewRoleDraft.fields[fieldKey] || defaultRoleFieldPermission(field, fieldIndex, previewRoleKind) : undefined;
    return previewFieldPermission(selectedPreviewFlowNode?.fieldPermissions?.[fieldKey], rolePermission, previewRoleCanView, previewRoleCanFill);
  };
  const previewControls = layoutControls.filter((control) => {
    if (control.source !== 'field') return true;
    const permission = getPreviewFieldPermission(control.fieldKey);
    return permission?.visible !== false;
  });

  const permissionActionRows = permissionActionDefinitions.map((item) => ({
    ...item,
    enabled: activePermissionDraft.actions[item.key] ?? getDefaultPermissionActionEnabled(activePermissionRoleKind, item.key),
  }));
  const permissionActionRowsByKey = Object.fromEntries(permissionActionRows.map((item) => [item.key, item]));
  const enabledPermissionActionCount = permissionActionRows.filter((item) => item.enabled).length;
  const editablePermissionFieldCount = baseConfig.fields.filter((field, index) => getRoleFieldPermission(field, index).editable).length;
  const requiredPermissionFieldCount = baseConfig.fields.filter((field, index) => getRoleFieldPermission(field, index).required).length;
  const permissionFieldPageSize = 60;
  const filteredPermissionFields = baseConfig.fields
    .map((field, index) => ({ field, index, permission: getRoleFieldPermission(field, index) }))
    .filter(({ field, permission }) => {
      const query = fieldPermissionQuery.trim().toLowerCase();
      const matchesQuery = !query || field.name.toLowerCase().includes(query) || field.key.toLowerCase().includes(query);
      const matchesFilter =
        fieldPermissionFilter === 'all'
        || (fieldPermissionFilter === 'hidden' && !permission.visible)
        || (fieldPermissionFilter === 'editable' && permission.editable)
        || (fieldPermissionFilter === 'required' && permission.required)
        || (fieldPermissionFilter === 'exportable' && permission.exportable);
      return matchesQuery && matchesFilter;
    });
  const fieldPermissionPageCount = Math.max(1, Math.ceil(filteredPermissionFields.length / permissionFieldPageSize));
  const safeFieldPermissionPage = Math.min(fieldPermissionPage, fieldPermissionPageCount);
  const pagedPermissionFields = filteredPermissionFields.slice(
    (safeFieldPermissionPage - 1) * permissionFieldPageSize,
    safeFieldPermissionPage * permissionFieldPageSize,
  );
  const hasResolvedRemoteDesignerConfig = Boolean(
    databaseMetaByForm[staticBaseConfig.id]
    || platformForm?.code === staticBaseConfig.id
    || String(platformForm?.id) === staticBaseConfig.id,
  );
  const shouldWaitForDatabaseConfig = (
    isResolvingPlatformConfig
    && !hasResolvedRemoteDesignerConfig
  );
  const standaloneDraftGuard = !embeddedDraftGuard && <StandaloneDraftGuard dirty={hasUnsavedChanges} />;

  if (shouldWaitForDatabaseConfig) {
    return (
      <div className="form-designer-page form-designer-embedded">
        {standaloneDraftGuard}
        <div className="form-designer-loading-state">
          <Spin />
          <Typography.Text type="secondary">正在加载数据库表单配置...</Typography.Text>
        </div>
      </div>
    );
  }

  const sourcePortal = (node:React.ReactNode,target:HTMLElement|null|undefined) => workspaceTargets ? target?createPortal(node,target):null : node;
  const sourceStatus = hasUnsavedChanges?'未保存修改':viewConfigMeta.status==='published'?'与线上版本一致':'草稿待发布';
  const propertyScope: PropertyPanelScope = {
    embedded: true,
    baseConfig,
    layoutControls,
    platformForm,
    selectedControl,
    selectedControlId,
    selectedField,
    selectedEffectiveControlType,
    selectedControlUsesDataSource,
    selectedReferenceSourceKind,
    selectedReferenceConfig,
    selectedControlUsesEncoding,
    selectedEncodingRule,
    optionCatalog,
    referenceForms,
    referenceLabelOptions,
    testingOptionSource,
    hiddenRequiredControls,
    controlTypeOptions,
    textFormatOptions,
    textTrimModeOptions,
    textCaseModeOptions,
    selectionModeOptions,
    selectionDisplayOptions,
    dateModeOptions,
    defaultDateOptions,
    searchDraft,
    assignmentDraft,
    assignmentSourceAttributeOptions,
    assignmentTargetFieldOptions,
    defaultValueDraft,
    calculationDraft,
    calculationBusy,
    calculationError,
    calculationResult,
  };
  const propertyActions: PropertyPanelActions = {
    updateSelectedControl,
    updateSelectedTypeSettings,
    updateSelectedEncodingRule,
    controlRuleToggle,
    openSearchSettings,
    updateSearchSettings,
    updateSearchSample,
    testOptionSearch,
    setTestingOptionSource,
    setEncodingSettingsDraft,
    encodingRuleTargetRef,
    setAssignmentDraft,
    addAssignmentRule,
    updateAssignmentRule,
    removeAssignmentRule,
    setDefaultValueDraft,
    getFieldDefaultValue,
    setCalculationDraft,
    setCalculationError,
    setCalculationResult,
    updateCalculationDraft,
    checkCalculation,
  };
  const canvasScope: CanvasScope = {
    embedded: true,
    baseConfig,
    layoutControls,
    platformForm,
    selectedControl,
    selectedControlId,
    containerTabs,
    draggedControlId,
    dropHint,
    previewStates,
    previewValues,
    previewForm,
    previewRuleError,
    canvasSettings,
    previewControls,
  };
  const canvasActions: CanvasActions = {
    duplicateControl,
    removeControl,
    getCanvasControlDragProps,
    handleContainerDrop,
    updateSelectedControl,
    commitLayoutChange,
    setContainerTabs,
    setSelectedControlId,
    setSelectedAssetKey,
    updateSelectedTypeSettings,
    getPreviewFieldPermission,
    setPreviewValues,
  };
  return (
    <div className={`form-designer-page form-designer-embedded${workspaceTargets?' form-designer-unified':''}`}>
      {standaloneDraftGuard}
      {workspaceTargets&&<>
        {sourcePortal(<Tooltip title={sourceStatus}><span className={'analytics-save-indicator'+(hasUnsavedChanges?' is-dirty':viewConfigMeta.status!=='published'?' is-pending':'')} role="status" aria-label={sourceStatus} tabIndex={0}/></Tooltip>,workspaceTargets.status)}
        {sourcePortal(<Space size={0}>
          <><Tooltip title="撤销布局修改"><Button type="text" size="small" aria-label="撤销布局修改" icon={<UndoOutlined/>} disabled={activeTab!=='form'||!history.length||isPersistingFlow} onClick={undoLayoutChange}/></Tooltip><Tooltip title="重做布局修改"><Button type="text" size="small" aria-label="重做布局修改" icon={<RedoOutlined/>} disabled={activeTab!=='form'||!future.length||isPersistingFlow} onClick={redoLayoutChange}/></Tooltip></>
          {!isAnalysisDesigner && <Tooltip title="试填表单"><Button type="text" size="small" aria-label="试填表单" icon={<EyeOutlined/>} disabled={isPersistingFlow} onClick={()=>setPreviewOpen(true)}/></Tooltip>}
          <Tooltip title="数据源版本管理"><Button type="text" size="small" aria-label="数据源版本管理" icon={<HistoryOutlined/>} disabled={isPersistingFlow} onClick={()=>setVersionPanelOpen(true)}/></Tooltip>
          <Tooltip title="保存草稿"><Button type="text" size="small" aria-label="保存草稿" icon={<SaveOutlined/>} loading={isPersistingFlow} onClick={saveDraft}/></Tooltip>
          <Tooltip title="发布更改"><Button type="primary" size="small" aria-label="发布更改" icon={<CheckCircleOutlined/>} loading={isPersistingFlow} onClick={publishConfig}/></Tooltip>
        </Space>,workspaceTargets.actions)}
      </>}
      {permissionOnly && <header className="form-designer-toolbar">
        <div className="form-designer-title">
          <Tooltip title="返回业务数据"><Button className="form-editor-back" aria-label="返回业务数据" icon={<ArrowLeftOutlined />} disabled={isPersistingFlow} onClick={warnBeforeLeave} /></Tooltip>
          <div className="form-editor-identity"><strong>{baseConfig.name}</strong><span className="designer-draft-status">权限管理</span></div>
        </div>
        <Space className="form-designer-actions" size={4}>
          <Button size="small" aria-label="版本管理" icon={<HistoryOutlined />} disabled={!platformForm || isPersistingFlow} onClick={() => setVersionPanelOpen(true)}>版本管理</Button>
          <Button size="small" type="primary" aria-label="发布更改" icon={<CheckCircleOutlined />} disabled={!platformForm} loading={isPersistingFlow} onClick={publishConfig}>发布更改</Button>
        </Space>
      </header>}
      {aiFormDraft && <header className="form-designer-toolbar">
        <div className="form-designer-title">
          <Tooltip title="返回业务数据"><Button className="form-editor-back" aria-label="返回业务数据" icon={<ArrowLeftOutlined />} disabled={isPersistingFlow} onClick={warnBeforeLeave} /></Tooltip>
          <div className="form-editor-identity"><strong>{aiFormDraft.name}</strong><span className="designer-draft-status">草稿待确认</span></div>
        </div>
        <Space className="form-designer-actions" size={4}>
          <Tooltip title="撤销布局修改"><Button size="small" type="text" aria-label="撤销布局修改" disabled={!history.length} icon={<UndoOutlined />} onClick={undoLayoutChange} /></Tooltip>
          <Tooltip title="重做布局修改"><Button size="small" type="text" aria-label="重做布局修改" disabled={!future.length} icon={<RedoOutlined />} onClick={redoLayoutChange} /></Tooltip>
          <Button size="small" type="text" aria-label="试填表单" icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>试填表单</Button>
          <Button size="small" type="primary" aria-label="确认创建草稿" icon={<SaveOutlined />} loading={isPersistingFlow} disabled={!draftReviewReady} onClick={saveDraft}>确认创建草稿</Button>
        </Space>
      </header>}

      <section className={`form-designer-shell ${isNoLeftTab ? 'form-designer-shell-no-left' : ''} ${activeTab === 'flow' ? 'form-designer-shell-flow' : ''} ${activeTab === 'permission' ? 'form-designer-shell-permission' : ''}`}>
        {!isNoLeftTab && (
          <aside className="form-designer-left">
            <div className="designer-panel-head">
              <strong><LayoutOutlined />字段与布局</strong>
            </div>
              <div className="designer-library-search">
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索字段、控件或分类"
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                />
              </div>

              <Segmented
                block
                className="designer-library-switch"
                value={componentPanel}
                onChange={(value) => setComponentPanel(value as ComponentPanel)}
                options={[
                  {
                    label: <Tooltip title="点击或拖入填写控件、分组和布局容器。"><span>添加控件</span></Tooltip>,
                    value: 'components',
                  },
                  {
                    label: <Tooltip title="点击已使用的字段进行设置；点击未使用的字段添加到表单。"><span>表单字段</span></Tooltip>,
                    value: 'fieldTypes',
                  },
                ]}
              />
              <div className="designer-quick-panel">
                <div className="designer-group-title">快捷排版</div>
                <div className="designer-side-guide">
                  <strong>配置引导</strong>
                  <span>拖入字段或控件，选中后在右侧配置属性。</span>
                  <div>
                    <Tag color="blue">字段 {libraryFields.length}</Tag>
                    <Tag color="green">控件 {layoutControls.length}</Tag>
                  </div>
                </div>
                <div className="designer-quick-grid">
                  <Button size="small" icon={<LayoutOutlined />} onClick={applyTwoColumnLayout}>两列</Button>
                  <Button size="small" icon={<TableOutlined />} onClick={applyCompactLayout}>紧凑</Button>
                  <Button size="small" icon={<ApartmentOutlined />} onClick={applyBusinessSectionLayout}>业务分组</Button>
                </div>
                <div className="designer-quick-grid">
                  <Button size="small" icon={<CheckSquareOutlined />} onClick={batchSetRequired}>批量必填</Button>
                  <Button size="small" onClick={() => batchUpdateVisibleControls({ width: 'full' })}>全宽</Button>
                  <Button size="small" icon={<UndoOutlined />} disabled={!history.length} onClick={undoLayoutChange}>撤销</Button>
                </div>
                <div className="designer-side-sections">
                  {alertSections.map((section) => (
                    <button key={section.key} type="button" onClick={applyBusinessSectionLayout}>
                      <strong>{section.title}</strong>
                      <small>{section.desc}</small>
                    </button>
                  ))}
                </div>
              </div>
              {componentPanel === 'components' ? (
                <div className="designer-component-library">
                  <section className="designer-component-group">
                    <div className="designer-group-title">常用控件</div>
                    <small className="designer-library-hint">点击添加，也可拖入画布</small>
                    <div className="designer-component-list">
                      {filteredCommonControls.slice(0, 2).map((item) => (
                        <div
                          className="designer-component"
                          draggable
                          key={item.key}
                          data-desc={item.desc}
                          onClick={() => addComponentToCanvas(item)}
                          onDragEnd={() => setCanvasDragActive(false)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('componentKey', item.key);
                            setCanvasDragActive(true);
                          }}
                          title={`${item.name} / ${item.desc}`}
                        >
                          <span className="designer-component-icon">{item.icon}</span><span>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  {filteredComponentGroups.map((group) => (
                    <details className="designer-component-group designer-component-collapse" key={group.category} open>
                      <summary className="designer-group-title">
                        <span>{group.category}</span>
                        <small>{group.items.filter(item=>!['summary-card','status-tag','file-preview','approval-comment','operation-log','status-flow','risk-level'].includes(item.controlType)).length} 个</small>
                      </summary>
                      <div className="designer-component-list">
                        {group.items.filter(item=>!['summary-card','status-tag','file-preview','approval-comment','operation-log','status-flow','risk-level'].includes(item.controlType)).map((item) => (
                          <div
                            className="designer-component"
                            draggable
                            key={item.key}
                            data-desc={item.desc}
                            onClick={() => addComponentToCanvas(item)}
                            onDragEnd={() => setCanvasDragActive(false)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('componentKey', item.key);
                              setCanvasDragActive(true);
                            }}
                            title={`${item.name} / ${item.desc}`}
                          >
                            <span className="designer-component-icon">{item.icon}</span><span>{item.name}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <section className="designer-component-group designer-field-library-group">
                  <div className="designer-group-title">
                    <span>字段库</span>
                    <small>{filteredLibraryFields.length} / {libraryFields.length} 个</small>
                  </div>
                  <div className="designer-field-list">
                    {filteredLibraryFields.map((field) => {
                      const isFieldOnCanvas = canvasFieldKeySet.has(field.key);
                      return (
                        <div
                          className={`designer-field ${selectedAssetKey === field.key ? 'designer-field-active' : ''} ${isFieldOnCanvas ? 'designer-field-used' : ''}`}
                          draggable
                          key={field.key}
                          onClick={() => {
                            if (!isFieldOnCanvas) { addFieldToCanvas(field); return; }
                            setSelectedAssetKey(field.key);
                            setSelectedControlId(layoutControls.find(control => control.fieldKey === field.key)?.id || '');
                          }}
                          onDragStart={(event) => event.dataTransfer.setData('fieldKey', field.key)}
                          title={`${field.name} / ${field.key} / ${field.type}`}
                        >
                          <span>{field.name}</span>
                          {isFieldOnCanvas && <CheckCircleOutlined className="designer-field-check" />}
                          {!isFieldOnCanvas && <PlusOutlined />}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
        </aside>
        )}

        <main className="form-designer-canvas">
          {activeTab === 'form' && (
            <div
              className="canvas-board create-form-canvas"
              onClick={() => { setSelectedControlId(''); setSelectedAssetKey(''); }}
              onDragEnter={() => setCanvasDragActive(true)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setCanvasDragActive(false);
                  setDropHint(null);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setCanvasDragActive(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const layoutControlId = event.dataTransfer.getData('layoutControlId');
                if (layoutControlId) {
                  moveLayoutControlToEnd(layoutControlId);
                  setDraggedControlId('');
                  setDropHint(null);
                  setCanvasDragActive(false);
                  return;
                }
                const fieldKey = event.dataTransfer.getData('fieldKey');
                const componentKey = event.dataTransfer.getData('componentKey');
                const field = baseConfig.fields.find((item) => item.key === fieldKey);
                const component = componentGroups.flatMap((group) => group.items).find((item) => item.key === componentKey);
                if (field) addFieldToCanvas(field);
                if (component) addComponentToCanvas(component);
                setCanvasDragActive(false);
              }}
            >
              <div className="designer-canvas-context" onClick={event => event.stopPropagation()}>
                <button type="button" onClick={() => { setSelectedControlId(''); setSelectedAssetKey(''); }}><LayoutOutlined /> 表单画布</button>
                <span>{layoutControls.filter(control => !isLayoutContainer(control)).length} 个控件 · 点击选择，拖动排序</span>
              </div>
              <div className="create-form-modal" style={{ backgroundColor: renderedAppearance.backgroundColor }} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) { setSelectedControlId(''); setSelectedAssetKey(''); } }}>
                <FormAppearanceHeader appearance={renderedAppearance} fallbackTitle={baseConfig.name} className="form-editor-canvas-heading" />
                <div style={{gap:canvasSettings.gap}} className={`create-form-grid${showCanvasGrid ? ' show-canvas-grid' : ''}${isCanvasDragActive ? ' canvas-drag-active' : ''}`} onClick={event => { if (event.target === event.currentTarget) { setSelectedControlId(''); setSelectedAssetKey(''); } }}>
                  {layoutControls.filter(control => !control.parentId).map(control => <CanvasControl key={control.id} control={control} scope={canvasScope} actions={canvasActions} />)}
                  {isCanvasDragActive && !dropHint && <div className="canvas-drop-end-indicator">拖到这里放在末尾</div>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'flow' && (
            <ProfessionalFlowDesigner
              externalInspector={Boolean(workspaceTargets)} propertiesTarget={workspaceTargets?.properties}
              config={professionalFlowConfig}
              fields={baseConfig.fields.map((field) => ({
                key: field.key,
                name: field.name,
                type: field.type,
                required: field.required,
              }))}
              roles={permissionRoles}
              roleOptions={identityRoleRecords.map((role) => ({ value: role.name, label: role.label }))}
              users={identityUsers.map((user) => ({ value: String(user.id), label: user.label }))}
              onChange={(nextConfig) => {
                setProfessionalFlowConfig(nextConfig);
                setHasAssociatedFlow(true);
                markUnsaved();
              }}
            />
          )}

          {activeTab === 'permission' && (
            <div className="permission-canvas">
              <div className="permission-workbench">
                <aside className="permission-role-rail">
                  <div className="permission-rail-head">
                    <div>
                      <div className="permission-section-title">1. 选择授权对象</div>
                      <small>来自用户与权限中心的角色</small>
                    </div>
                    <Space size={6}>
                      <Tag>{permissionRoles.length}</Tag>
                      <Button
                        aria-label="保存权限草稿"
                        icon={<SaveOutlined />}
                        loading={isPersistingPermissions}
                        onClick={savePermissionDesign}
                        size="small"
                        title="保存权限草稿（发布后生效）"
                        type="text"
                      />
                    </Space>
                  </div>
                  <Input size="small" prefix={<SearchOutlined />} placeholder="搜索角色" value={permissionRoleSearch} onChange={event=>setPermissionRoleSearch(event.target.value)} />
                  {permissionRoles.filter(role=>role.toLowerCase().includes(permissionRoleSearch.toLowerCase())).map((role, index) => (
                    <button
                      className={`permission-role-card ${role === activePermissionRole ? 'permission-role-active' : ''}`}
                      key={role}
                      type="button"
                      onClick={() => setSelectedPermissionRole(role)}
                    >
                      <span className="permission-role-icon"><UserSwitchOutlined /></span>
                      <span>
                        <strong>{role}</strong>
                        <small>{role === activePermissionRole ? '正在配置' : index === 0 ? '最高权限模板' : '点击切换配置'}</small>
                      </span>
                      <Tag color={role === activePermissionRole ? 'blue' : 'default'}>{index === 0 ? '全局' : '业务'}</Tag>
                    </button>
                  ))}
                </aside>

                <div className="permission-main">
                  <section className="permission-card permission-scope-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">1. 数据权限</div>
                        <span>决定角色可以看到哪些组织、记录和敏感信息</span>
                      </div>
                      <ApartmentOutlined />
                    </div>
                    <div className="permission-data-config">
                      <label>
                        <span>数据范围</span>
                        <Select
                          size="small"
                          value={activePermissionDraft.data.scope}
                          onChange={(scope) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, scope },
                          }))}
                          options={[
                            { value: 'all', label: '全部组织' },
                            { value: 'org_tree', label: '本组织及下级' },
                            { value: 'org', label: '仅本组织' },
                            { value: 'assigned', label: '本人创建 / 分派给我' },
                            { value: 'custom', label: '自定义范围' },
                          ]}
                        />
                      </label>
                      <label>
                        <span>自定义组织范围</span>
                        <Select
                          mode="multiple"
                          size="small"
                          disabled={activePermissionDraft.data.scope!=='custom'}
                          value={(activePermissionDraft.data.orgUnits || [])
                            .map((value) => Number(value))
                            .filter((value) => Number.isInteger(value) && value > 0)}
                          onChange={(orgUnits) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, orgUnits },
                          }))}
                          maxTagCount="responsive"
                          options={permissionOrgUnitOptions}
                        />
                      </label>
                      <label>
                        <span>敏感字段</span>
                        <Select
                          size="small"
                          value={activePermissionDraft.data.sensitiveFields}
                          onChange={(sensitiveFields) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, sensitiveFields },
                          }))}
                          options={[
                            { value: 'full', label: '遵循字段自身的脱敏规则' },
                            { value: 'mask', label: '详情与导出脱敏' },
                            { value: 'hide', label: '完全隐藏' },
                          ]}
                        />
                      </label>
                    </div>
                    <div className="permission-data-checks">
                      {[
                        ['createdByMe', '本人创建'],
                        ['assignedToMe', '分派给我'],
                        ['sameOrg', '同组织记录'],
                        ['crossOrg', '跨组织记录'],
                        ['statistics', '统计汇总数据'],
                      ].map(([key, label]) => (
                        <Checkbox
                          key={key}
                          checked={activePermissionDraft.data.ownership[key] !== false}
                          onChange={(event) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: {
                              ...draft.data,
                              ownership: { ...draft.data.ownership, [key]: event.target.checked },
                            },
                          }))}
                        >
                          {label}
                        </Checkbox>
                      ))}
                    </div>
                  </section>

                  <section className="permission-card permission-action-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">2. 动作权限</div>
                        <span>按角色分别控制列表入口、表单内按钮和流程处理动作</span>
                      </div>
                      <Tag color="green">{enabledPermissionActionCount} / {permissionActionRows.length} 已启用</Tag>
                    </div>
                    <div className="permission-action-groups">
                      {permissionActionGroups.map((group) => (
                        <div className="permission-action-group" key={group.key}>
                          <div className="permission-action-group-title">
                            <strong>{group.title}</strong>
                            <small>{group.desc}</small>
                          </div>
                          <div className="permission-action-grid">
                            {group.actionKeys.map((actionKey) => {
                              const item = permissionActionRowsByKey[actionKey];
                              if (!item) return null;
                              return (
                                <Tooltip
                                  key={item.key}
                                  title={`${item.desc}；风险等级：${item.risk === 'high' ? '高' : item.risk === 'medium' ? '中' : '低'}`}
                                  placement="top"
                                >
                                  <label className={`permission-toggle-row permission-action-toggle-row ${item.enabled ? 'permission-action-toggle-on' : 'permission-action-toggle-off'}`}>
                                    <span>
                                      <strong>{item.name}</strong>
                                    </span>
                                    <Switch
                                      size="small"
                                      checked={item.enabled}
                                      onChange={(checked) => updateActivePermissionDraft((draft) => ({
                                        ...draft,
                                        actions: { ...draft.actions, [item.key]: checked },
                                      }))}
                                    />
                                  </label>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="permission-card permission-field-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">3. 角色字段权限</div>
                        <span>按字段搜索和筛选后批量处理当前角色的运行时覆盖；字段默认参数仍在字段设置里维护</span>
                      </div>
                      <Space size={6}>
                        <Tag color="green">字段 {baseConfig.fields.length}</Tag>
                        <Tag color="blue">可编辑 {editablePermissionFieldCount}</Tag>
                        <Tag color="orange">角色必填 {requiredPermissionFieldCount}</Tag>
                        <Dropdown disabled={!filteredPermissionFields.length} menu={{items:[{key:'visible',label:'可见'},{key:'editable',label:'可编辑'},{key:'required',label:'角色必填'},{key:'exportable',label:'允许导出'}].map(item=>({...item,children:[{key:`${item.key}:1`,label:'全部启用'},{key:`${item.key}:0`,label:'全部关闭'}]})),onClick:({key})=>{
                          const [property,flag]=key.split(':');const enabled=flag==='1';
                          updateActivePermissionDraft(draft=>{const fields={...draft.fields};for(const {field,permission} of filteredPermissionFields){if(property==='editable'&&field.locked)continue;fields[field.key]={...permission,[property]:enabled,...(property==='visible'&&!enabled?{editable:false,required:false,exportable:false}:{}),...(property!=='visible'&&enabled?{visible:true}:{})};}return {...draft,fields};});
                        }}}><Button size="small">批量设置</Button></Dropdown>
                      </Space>
                    </div>
                    <div className="permission-field-tools">
                      <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索字段名称或编码"
                        value={fieldPermissionQuery}
                        onChange={(event) => {
                          setFieldPermissionQuery(event.target.value);
                          setFieldPermissionPage(1);
                        }}
                      />
                      <Select
                        value={fieldPermissionFilter}
                        onChange={(value) => {
                          setFieldPermissionFilter(value);
                          setFieldPermissionPage(1);
                        }}
                        options={[
                          { value: 'all', label: '全部字段' },
                          { value: 'hidden', label: '隐藏字段' },
                          { value: 'editable', label: '可编辑' },
                          { value: 'required', label: '角色必填' },
                          { value: 'exportable', label: '允许导出' },
                        ]}
                      />
                      <span>{filteredPermissionFields.length} 个匹配字段</span>
                    </div>
                    <div className="permission-field-matrix">
                      <div className="permission-field-head">
                        <span>字段</span><span>可见</span><span>编辑</span><span>必填</span><span>导出</span>
                      </div>
                      <div className="permission-field-list">
                      {pagedPermissionFields.map(({ field, index, permission }) => {
                        return (
                          <div className="permission-field-row" key={field.key}>
                            <span title={`${field.name} / ${field.key}`}>
                              <strong>{field.name}</strong>
                              <small>{field.key}</small>
                            </span>
                            <Switch
                              size="small"
                              checked={permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, {
                                visible: checked,
                                editable: checked ? permission.editable : false,
                                required: checked ? permission.required : false,
                              })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.editable}
                              disabled={field.locked || !permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { editable: checked })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.required}
                              disabled={!permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { required: checked })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.exportable}
                              disabled={!permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { exportable: checked })}
                            />
                          </div>
                        );
                      })}
                      </div>
                      <div className="permission-field-pager">
                        <span>
                          第 {safeFieldPermissionPage} / {fieldPermissionPageCount} 页，每页 {permissionFieldPageSize} 个字段
                        </span>
                        <Space size={6}>
                          <Button
                            size="small"
                            disabled={safeFieldPermissionPage <= 1}
                            onClick={() => setFieldPermissionPage((page) => Math.max(1, page - 1))}
                          >
                            上一页
                          </Button>
                          <Button
                            size="small"
                            disabled={safeFieldPermissionPage >= fieldPermissionPageCount}
                            onClick={() => setFieldPermissionPage((page) => Math.min(fieldPermissionPageCount, page + 1))}
                          >
                            下一页
                          </Button>
                        </Space>
                      </div>
                    </div>
                  </section>

                </div>
              </div>
            </div>
          )}
        </main>

        {!isAnalysisDesigner && activeTab === 'form' && (
        sourcePortal(<aside className="form-designer-right property-inspector">
          <PropertyInspectorHeader title={selectedControl ? '控件属性' : '表单外观'} context={selectedControl?.name || baseConfig.name} />
          {selectedControl ? (
            <div className="designer-props">
              <ControlIdentityProperties scope={propertyScope} actions={propertyActions} />
              <PropertyGroup title="布局属性" className="designer-prop-section" titleClassName="designer-prop-section-title">
                <LayoutWidthProperties scope={propertyScope} actions={propertyActions} />
                <ContainerProperties scope={canvasScope} actions={canvasActions} />
                <LayoutAppearanceProperties scope={propertyScope} actions={propertyActions} />
              </PropertyGroup>
              <InteractionProperties scope={propertyScope} actions={propertyActions} />
              {!isLayoutControl(selectedControl) && <>
                <TypeSpecificProperties scope={propertyScope} actions={propertyActions} />
                <TableProperties scope={canvasScope} actions={canvasActions} />
                <DataAttributeProperties scope={propertyScope} actions={propertyActions} />
              </>}
            </div>
          ) : (
            <div className="designer-props">
              <FormAppearanceProperties
                value={formAppearance}
                formName={baseConfig.name}
                disabled={isResolvingPlatformConfig || isPersistingFlow}
                onChange={updateFormAppearance}
              />
              <PropertyGroup title="编辑辅助" className="designer-canvas-property-group">
                <PropertyRow label="显示背景网格">
                  <Switch size="small" checked={showCanvasGrid} onChange={setShowCanvasGrid} />
                </PropertyRow>
              </PropertyGroup>
            </div>
          )}
        </aside>,workspaceTargets?.properties)
        )}
      </section>

      <Modal centered className="form-designer-dialog encoding-rule-modal search-rule-modal" title={<div className="encoding-dialog-title"><SearchOutlined/><span>搜索设置</span></div>} width={980} open={Boolean(searchDraft)} okText="应用设置" cancelText="取消" onCancel={()=>{++searchRequestEpoch.current;setSearchDraft(null);}} onOk={applySearchSettings} okButtonProps={{disabled:!searchDraft?.schema||searchDraft.metaLoading}}>
        {<SearchSettingsEditor scope={propertyScope} actions={propertyActions} />}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal calculation-rule-modal" title={<div className="encoding-dialog-title"><NumberOutlined /><span>计算规则</span></div>} width={860} open={Boolean(calculationDraft)} onCancel={closeCalculationEditor}
        footer={<div className="encoding-rule-footer"><Button type="text" danger icon={<DeleteOutlined />} disabled={!layoutControls.find(control => control.id === calculationDraft?.controlId)?.computed || calculationBusy} onClick={() => {
          commitLayoutChange(controls => controls.map(control => control.id === calculationDraft?.controlId ? { ...control, computed: null, calculationRulesEnabled: false, inactiveCalculationRule: undefined } : control)); closeCalculationEditor();
        }}>删除规则</Button><Space size={8}><Button type="text" onClick={closeCalculationEditor}>取消</Button><Button type="primary" loading={calculationBusy} onClick={() => checkCalculation(true)}>保存规则</Button></Space></div>}>
        {<CalculationEditor scope={propertyScope} actions={propertyActions} />}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal assignment-rule-modal" title={<div className="encoding-dialog-title"><SettingOutlined /><span>赋值规则</span></div>} width={860} open={Boolean(assignmentDraft)} onCancel={() => setAssignmentDraft(null)} onOk={applyAssignmentDraft} okText="应用规则" cancelText="取消">
        {<AssignmentEditor scope={propertyScope} actions={propertyActions} />}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal default-rule-modal" title={<div className="encoding-dialog-title"><SettingOutlined /><span>默认值规则</span><span className="default-rule-title-note">新增时预填一次，允许手动修改；编辑已有记录不重算。</span></div>} open={Boolean(defaultValueDraft)} width={980}
        okText="应用规则" cancelText="取消" onCancel={() => setDefaultValueDraft(null)} onOk={applyDefaultValueDraft}>
        {<DefaultValueEditor scope={propertyScope} actions={propertyActions} />}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal encoding-scheme-modal" title={<div className="encoding-dialog-title"><NumberOutlined /><span>编码规则</span></div>} open={Boolean(encodingSettingsDraft)}
        afterOpenChange={(open) => { if (open) encodingEditorRef.current?.scrollTo({ top: 0 }); }}
        onCancel={dismissEncodingSettings} footer={<div className="encoding-rule-footer">
          <Button className="encoding-rule-delete" danger type="text" icon={<DeleteOutlined />} disabled={!encodingSettingsDraft || !getEncodingRules(encodingRuleTargetRef.current?.rule).some(rule => rule.id === encodingSettingsDraft.id)} onClick={deleteEncodingSettings}>删除规则</Button>
          <Space size={8}><Button type="text" className="encoding-rule-cancel" onClick={dismissEncodingSettings}>取消</Button><Button type="primary" className="encoding-rule-save" onClick={commitEncodingSettings}>保存规则</Button></Space>
        </div>} width={980}>
        {encodingSettingsDraft && <div className="encoding-rule-workspace">
          <div className="encoding-rule-editor" ref={encodingEditorRef}>
            <section className="encoding-editor-section encoding-rule-basics">
              <div className="encoding-basics-fields"><label className="encoding-editor-field"><span>规则名称</span><Input aria-label="编码规则名称" value={encodingSettingsDraft.name}
                placeholder="例如：成品物料编码" maxLength={60}
                onChange={(e) => setEncodingSettingsDraft({ ...encodingSettingsDraft, name: e.target.value })} /></label>
                <label className="encoding-editor-field"><span>生成方式</span><Select aria-label="编码生成方式" value={encodingSettingsDraft.generationMode || 'auto'} options={encodingGenerationModeOptions}
                  onChange={(generationMode) => setEncodingSettingsDraft({ ...encodingSettingsDraft, generationMode,
                    allowManualOverride: generationMode === 'autoEditable' || generationMode === 'manual' })} /></label>
              </div>
            </section>
            <section className="encoding-editor-section encoding-rule-conditions">
              <div className="encoding-section-title encoding-trigger-heading">
                <strong>何时触发<Tooltip title="不添加条件时不限制触发；点击右侧加号添加条件，只有全部条件满足时才使用此编码规则。删除全部条件可恢复无限制触发。" trigger={['hover','focus']}><button type="button" className="encoding-trigger-help" aria-label="何时触发说明"><QuestionCircleOutlined /></button></Tooltip></strong>
                <Button size="small" type="text" icon={<PlusOutlined />} aria-label="添加触发条件" title="添加触发条件" onClick={() => setEncodingSettingsDraft({ ...encodingSettingsDraft, conditions: [...(encodingSettingsDraft.conditions || []), {sourceField: assignmentTargetFieldOptions.find(option => option.value !== selectedField?.key)?.value, operator:'eq',value:''}] })}>添加触发条件</Button>
              </div>
              {Boolean(encodingSettingsDraft.conditions?.length) && <>
                {encodingSettingsDraft.conditions?.map((condition,index) => <div className="encoding-condition-row" key={index}>
                  <Select aria-label={`条件字段 ${index + 1}`} placeholder="选择字段" value={condition.sourceField} options={assignmentTargetFieldOptions}
                    onChange={(sourceField) => setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,sourceField}:c)})} />
                  <Select aria-label={`条件运算符 ${index + 1}`} value={condition.operator} options={[
                    {value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'contains',label:'包含'},
                    {value:'gte',label:'大于等于'},{value:'lte',label:'小于等于'},{value:'isEmpty',label:'为空'},{value:'notEmpty',label:'不为空'}]}
                    onChange={(operator)=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,operator}:c)})} />
                  {['isEmpty','notEmpty'].includes(condition.operator || '') ? <span className="encoding-no-value">无需填写值</span> :
                    <Input aria-label={`条件值 ${index + 1}`} placeholder="填写匹配值" value={condition.value}
                      onChange={(e)=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,value:e.target.value}:c)})} />}
                  <Button aria-label={`删除条件 ${index + 1}`} type="text" icon={<DeleteOutlined />}
                    onClick={()=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.filter((_,i)=>i!==index)})} />
                </div>)}
              </>}
            </section>
            <section className="encoding-editor-section encoding-rule-composition">
              <div className="encoding-section-title encoding-composition-heading">
                <strong>编码段配置 <span className="encoding-section-count">{selectedEncodingSegments.length} 段</span></strong>
                <div className="encoding-heading-preview" aria-label="生成结果预览" aria-live="polite"><span>生成结果预览</span><code>{encodingSettingsDraft.generationMode === 'manual' ? '手工录入' : selectedEncodingSegments.some(segment => encodingSegmentLengthError(segment)) ? '存在超长编码段，请调整' : selectedEncodingSegments.length ? renderEncodingSample({...encodingSettingsDraft,enabled:true},baseConfig.fields) : '—'}</code></div>
                {encodingSettingsDraft.generationMode !== 'manual' && <Button size="small" type="text" icon={<PlusOutlined />} onClick={()=>openEncodingSegmentEditor()}>添加编码段</Button>}
              </div>
              {encodingSettingsDraft.generationMode === 'manual' ? <p className="encoding-editor-hint">由使用者录入完整编码，不使用自动编码段。</p> : <>
                {!selectedEncodingSegments.length && <div className="encoding-empty-segments">尚未配置编码段，请点击右上角添加。</div>}
                <div className="encoding-segment-flow-scroll"><div className="encoding-segment-flow">
                  <div className="encoding-segment-list">
                    {selectedEncodingSegments.map((segment,index) => <div
                      className={`encoding-segment-item ${draggedEncodingSegmentId === String(index) ? 'is-dragging' : ''}`}
                      key={segment.id || index} data-encoding-segment-id={index} role={encodingSegmentEditor.open && encodingSegmentEditor.index === index ? undefined : "button"} tabIndex={0}
                      aria-label={`编辑编码段：${segment.name || getEncodingSegmentTypeLabel(segment.type)}`}
                      title="双击编辑，拖拽调整顺序"
                      onKeyDown={event => {
                        if (encodingSegmentEditor.open || event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEncodingSegmentEditor(segment,index); }
                        if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                          event.preventDefault();
                          const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                          if (target < 0 || target >= selectedEncodingSegments.length) return;
                          const next = [...selectedEncodingSegments]; next.splice(index,1); next.splice(target,0,segment); syncEncodingSegments(next);
                        }
                      }}
                      onPointerDown={event => {
                        if (encodingSegmentEditor.open || event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, .ant-select, .ant-select-dropdown, .ant-input-number')) return;
                        encodingSegmentPointer.current = { id: String(index), x: event.clientX, y: event.clientY };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={event => {
                        const pointer = encodingSegmentPointer.current;
                        if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) setDraggedEncodingSegmentId(pointer.id);
                      }}
                      onPointerUp={event => {
                        const pointer = encodingSegmentPointer.current;
                        if (!pointer) return;
                        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) {
                          const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-encoding-segment-id]');
                          const sourceIndex = Number(pointer.id);
                          const targetIndex = target ? Number(target.getAttribute('data-encoding-segment-id')) : -1;
                          if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
                            const next = [...selectedEncodingSegments]; const [moved] = next.splice(sourceIndex,1); next.splice(targetIndex,0,moved); syncEncodingSegments(next);
                          }
                        }
                        encodingSegmentPointer.current = null; setDraggedEncodingSegmentId(null);
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                      onPointerCancel={() => { encodingSegmentPointer.current = null; setDraggedEncodingSegmentId(null); }}

                    >
                      <HolderOutlined className="encoding-segment-grip" />
                      {renderEncodingSegmentContents(segment,index)}
                      <div className="encoding-segment-actions">
                        <Button size="small" type="text" title="删除编码段" aria-label={`删除编码段：${segment.name || getEncodingSegmentTypeLabel(segment.type)}`} icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); removeEncodingSegment(index); }} />
                      </div>

                    </div>)}
                  </div>
                </div></div>
              </>}
            </section>
          </div>
        </div>}

      </Modal>

      <Modal
        centered
        className="form-designer-dialog designer-preview-modal"
        footer={<div className="trial-footer">
          <span><LockOutlined /> {isAnalysisDesigner ? '示意数据 · 仅预览布局' : '试填内容不会保存为业务记录'}</span>
          <Space size={10}>
            <Button onClick={() => setPreviewOpen(false)}>返回设计</Button>
            {!isAnalysisDesigner && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => previewForm.validateFields().then(() => message.success('预览必填及选择数量校验通过；数值、格式及字节限制以运行页保存校验为准')).catch(() => {})}>检查必填项</Button>}
          </Space>
        </div>}
        onCancel={() => setPreviewOpen(false)}
        open={previewOpen}
        title={<div className="trial-title">
          <span className="trial-title-icon"><EyeOutlined /></span>
          <div><div className="trial-title-line"><span>{isAnalysisDesigner ? '看板布局预览' : '试填表单'}</span><Tag>当前草稿</Tag></div>
            <p>{isAnalysisDesigner ? '检查组件布局，真实数据请在发布后的运行页验证。' : '体验填写过程，检查表单布局、必填规则与节点权限。'}</p>
          </div>
        </div>}
        width={1120}
      >
        {!isAnalysisDesigner && <div className="trial-controls">
          <div className="trial-scenario">
            <label className="trial-context-field"><span className="trial-control-label"><ApartmentOutlined /> 流程节点</span>
              <Select className="designer-preview-node-select" aria-label="试填流程节点"
                value={selectedPreviewFlowNode?.id} onChange={setPreviewFlowNodeId} options={previewFlowNodeOptions}
                disabled={!previewFlowNodeOptions.length || isResolvingPlatformConfig} loading={isResolvingPlatformConfig}
                placeholder="请先关联流程" notFoundContent="请在流程与审批中关联流程" />
            </label>
            <label className="trial-context-field"><span className="trial-control-label"><UserSwitchOutlined /> 预览角色</span>
              <Select className="designer-preview-role-select" aria-label="试填角色" value={activePreviewRole}
                onChange={setPreviewRole} options={permissionRoles.map(role => ({ value: role, label: role }))}
                disabled={!permissionRoles.length} placeholder="请先配置角色" />
            </label>
            {!aiFormDraft && !isAnalysisDesigner && <Button type="link" className="trial-flow-link" onClick={() => { setPreviewOpen(false); onTabChange?.('flow'); }}>流程与审批 <ArrowLeftOutlined rotate={180} /></Button>}
          </div>
          <div className="trial-context-note">
            {flowLoadError || (hasAssociatedFlow ? `流程：${professionalFlowConfig.name}。${getPreviewNodeNote(selectedPreviewFlowNode)}` : '尚未关联流程，请在「流程与审批」中配置。')}
            <span>角色权限与「权限管理」保持同步。{!previewRoleCanView ? '该角色无权查看此表单。' : !previewRoleCanFill ? '当前角色或节点仅可查看。' : ''}</span>
          </div>
        </div>}
        <div className="trial-stage">
        <div className="trial-stage-label"><span className="trial-live-dot" />表单预览<span>·</span><span>{isAnalysisDesigner ? '示意布局' : '与当前草稿同步'}</span></div>
        <div className="designer-preview-shell designer-preview-desktop">
          <div className="designer-preview-surface trial-canvas form-designer-embedded" style={{ backgroundColor: renderedAppearance.backgroundColor }}>
            <FormAppearanceHeader appearance={renderedAppearance} fallbackTitle={baseConfig.name} className="form-editor-canvas-heading" />
            <div className="trial-form-body"><PreviewContent scope={canvasScope} actions={canvasActions} /></div>
          </div>
        </div>
        </div>
      </Modal>

      <VersionManager
        title={workspaceTargets ? '数据源版本管理' : '版本管理'}
        open={versionPanelOpen}
        form={platformForm}
        name={baseConfig.name}
        hasUnsavedChanges={hasUnsavedChanges}
        draftStatus={viewConfigMeta.status}
        savedAt={viewConfigMeta.draftSavedAt}
        busy={isPersistingFlow || isResolvingPlatformConfig}
        loadError={flowLoadError}
        onClose={() => setVersionPanelOpen(false)}
        onEdit={() => setVersionPanelOpen(false)}
        onSave={saveDraft}
        onPublish={publishConfig}
        onRestore={async (version) => {
          if (!platformForm || isPersistingFlow) return false;
          setPersistingFlow(true);
          try {
            await restorePlatformFormDraft(platformForm.id, version);
            restoredDesignFormId.current = platformForm.id;
            setFieldDefaultValueDrafts({});
            setCopiedControl(null);
            setCopiedTree([]);
            setHistory([]);
            setFuture([]);
            setHasUnsavedChanges(false);
            setDesignerReloadKey(key => key + 1);
            message.success(version ? `已将 v${version} 恢复到草稿，发布后才会替换线上页面` : '已用线上配置重置草稿，可继续编辑后重新发布');
            return true;
          } catch {
            message.error('重置草稿失败，请重试');
            return false;
          } finally {
            setPersistingFlow(false);
          }
        }}
      />

      <Modal
        centered
        className="form-designer-dialog designer-rule-modal"
        destroyOnClose
        okText="保存规则"
        onCancel={() => {
          const opening=ruleOpeningValue.current;if(opening&&selectedControl?.id===opening.id)updateSelectedControl({rules:{...selectedControl.rules,[opening.key]:opening.value}});
          setEditingRuleGroupTitle(null);setRuleModal(null);ruleOpeningValue.current=null;
        }}
        onOk={() => {
          message.success(`${activeRuleLabel}规则已保存`);
          setEditingRuleGroupTitle(null);
          setRuleModal(null);
        }}
        open={Boolean(activeRule)}
        width={980}
        title={`${activeRuleLabel}规则`}
      >
        {ruleModal && activeRule && (
          <div className="designer-rule-form">
            <div className="designer-rule-window-layout">
              <aside className="designer-rule-window-sidebar">
                <button
                  className={`designer-rule-window-tab ${ruleWindowMode === 'common' ? 'designer-rule-window-tab-active' : ''}`}
                  type="button"
                  onClick={() => setRuleWindowMode('common')}
                >
                  通用窗口
                </button>
                <button
                  className={`designer-rule-window-tab ${ruleWindowMode === 'custom' ? 'designer-rule-window-tab-active' : ''}`}
                  type="button"
                  onClick={() => setRuleWindowMode('custom')}
                >
                  自定义窗口
                </button>
              </aside>
            <div className="designer-rule-group-editor">
              <div className="designer-rule-group-editor-head">
                <Button size="small" icon={<PlusOutlined />} onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}>
                  新增
                </Button>
              </div>
              <div className="designer-rule-group-list">
                {activeRuleConditionGroups.length ? (
                  <>
                    {activeRuleConditionGroups.map((group, groupIndex) => (
                      <React.Fragment key={`rule-group-${groupIndex}`}>
                        {groupIndex > 0 && <div className="designer-rule-or-divider">OR</div>}
                        <div className="designer-rule-condition-group">
                          <div className="designer-rule-condition-group-head">
                            {editingRuleGroupTitle?.ruleKey === ruleModal.ruleKey && editingRuleGroupTitle.groupIndex === groupIndex ? (
                              <Input
                                autoFocus
                                className="designer-rule-group-title-input"
                                size="small"
                                value={editingRuleGroupTitle.value}
                                onBlur={() => {
                                  updateSelectedRuleGroupTitle(ruleModal.ruleKey, groupIndex, editingRuleGroupTitle.value);
                                  setEditingRuleGroupTitle(null);
                                }}
                                onChange={(event) => setEditingRuleGroupTitle({
                                  ruleKey: ruleModal.ruleKey,
                                  groupIndex,
                                  value: event.target.value,
                                })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    setEditingRuleGroupTitle(null);
                                  }
                                }}
                                onPressEnter={() => {
                                  updateSelectedRuleGroupTitle(ruleModal.ruleKey, groupIndex, editingRuleGroupTitle.value);
                                  setEditingRuleGroupTitle(null);
                                }}
                              />
                            ) : (
                              <button
                                className="designer-rule-group-title"
                                type="button"
                                onDoubleClick={() => setEditingRuleGroupTitle({
                                  ruleKey: ruleModal.ruleKey,
                                  groupIndex,
                                  value: getRuleGroupTitle(activeRule, groupIndex),
                                })}
                                title="双击编辑"
                              >
                                {getRuleGroupTitle(activeRule, groupIndex)}
                              </button>
                            )}
                            <Button
                              className="designer-rule-add-condition"
                              size="small"
                              type="text"
                              icon={<PlusOutlined />}
                              onClick={() => addSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex)}
                            >
                              新增条件
                            </Button>
                          </div>
                          {group.map((condition, rowIndex) => (
                            <div className="designer-rule-condition-row" key={`rule-condition-${groupIndex}-${rowIndex}`}>
                              <Select
                                allowClear
                                placeholder="目标字段"
                                value={condition.sourceField}
                                onChange={(value) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, { sourceField: value, value: '' })}
                                options={conditionFieldOptions}
                              />
                              <Select
                                value={condition.operator || 'equals'}
                                onChange={(value) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, { operator: value })}
                                options={ruleOperatorOptions}
                              />
                              {renderRuleConditionValueControl(condition, groupIndex, rowIndex)}
                              <Button
                                aria-label="删除条件"
                                danger
                                size="small"
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => removeSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex)}
                              />
                            </div>
                          ))}
                          <Button
                            className="designer-rule-delete-group"
                            danger
                            icon={<DeleteOutlined />}
                            size="small"
                            type="text"
                            onClick={() => removeSelectedRuleConditionGroup(ruleModal.ruleKey, groupIndex)}
                          >
                            删除条件组
                          </Button>
                        </div>
                      </React.Fragment>
                    ))}
                    <Button
                      className="designer-rule-add-or"
                      icon={<PlusOutlined />}
                      size="small"
                      type="text"
                      onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}
                    >
                      添加或条件规则
                    </Button>
                  </>
                ) : (
                  <Button
                    className="designer-rule-empty-add"
                    icon={<PlusOutlined />}
                    size="small"
                    type="text"
                    onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}
                  >
                    添加条件规则
                  </Button>
                )}
              </div>
            </div>
            </div>
            {activeRule && ruleModal && false && (
            <label>
              <span>规则启用</span>
              <Segmented
                block
                value={activeRule?.enabled ? 'enabled' : 'disabled'}
                onChange={(value) => ruleModal && updateSelectedControlRule(ruleModal.ruleKey, { enabled: value === 'enabled' })}
                options={[
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '关闭' },
                ]}
              />
            </label>
            )}
            {activeRuleStrategyOptions.length > 0 && (
              <label className="designer-policy-setting">
                <span>规则策略</span>
                <Select
                  aria-label="规则策略" value={activeRule.conditions?.strategy || activeRuleStrategyOptions[0]?.value}
                  onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { strategy: value })}
                  options={activeRuleStrategyOptions}
                />
              </label>
            )}
            {ruleModal.ruleKey==='unique'&&activeRule.conditions?.strategy==='compound'&&<label className="designer-policy-setting"><span>组合字段</span><Select mode="multiple" aria-label="组合唯一字段" value={activeRule.conditions?.fields||[]} options={conditionFieldOptions.filter(option=>option.value!==selectedControl?.fieldKey)} onChange={fields=>updateSelectedRuleCondition('unique',{fields})}/><small>当前字段与所选字段的组合必须唯一；空值不参与检查。</small></label>}
            {ruleModal.ruleKey==='unique'&&<small>范围限当前租户；删除的记录不参与校验，编辑时排除记录自身。发布前会检查已有重复数据。</small>}
            {ruleModal.ruleKey==='masked'&&(activeRule.conditions?.strategy||'role')==='role'&&<label className="designer-policy-setting"><span>可查看原文的角色</span><Select mode="multiple" aria-label="可查看原文的角色" options={identityRoleRecords.map(role=>({value:role.id,label:role.label||role.name}))} value={activeRule.conditions?.roleIds||[]} onChange={roleIds=>updateSelectedRuleCondition('masked',{roleIds})}/><small>未选角色时所有人均脱敏；只影响字段展示，不授予表单访问权限。</small></label>}
            {ruleModal.ruleKey==='masked'&&activeRule.conditions?.strategy!=='hidden'&&<Space><label><span>保留开头字符</span><InputNumber aria-label="保留开头字符" min={0} max={20} value={activeRule.conditions?.keepStart??1} onChange={value=>updateSelectedRuleCondition('masked',{keepStart:value??1})}/></label><label><span>保留结尾字符</span><InputNumber aria-label="保留结尾字符" min={0} max={20} value={activeRule.conditions?.keepEnd??1} onChange={value=>updateSelectedRuleCondition('masked',{keepEnd:value??1})}/></label></Space>}
            {ruleModal.ruleKey==='copyable'&&<small>禁止复制会阻止运行页的复制、剪切与拖出操作；复制时脱敏保留首尾字符。此设置不是下载、截图或接口访问权限。</small>}
            <label>
              <span>条件来源字段</span>
              <Select
                allowClear
                placeholder="不选则始终生效"
                value={activeRule.conditions?.sourceField}
                onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { sourceField: value })}
                options={conditionFieldOptions}
              />
            </label>
            <label>
              <span>判断方式</span>
              <Select
                value={activeRule.conditions?.operator || 'equals'}
                onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { operator: value })}
                options={ruleOperatorOptions}
              />
            </label>
            <label>
              <span>条件值</span>
              <Input
                placeholder="例如：严重、已提交、当前用户"
                value={activeRule.conditions?.value || ''}
                onChange={(event) => updateSelectedRuleCondition(ruleModal.ruleKey, { value: event.target.value })}
              />
            </label>
            <label>
              <span>说明文本</span>
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="说明这条规则什么时候生效"
                value={activeRule.conditions?.note || ''}
                onChange={(event) => updateSelectedRuleCondition(ruleModal.ruleKey, { note: event.target.value })}
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
