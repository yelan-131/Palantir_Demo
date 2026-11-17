type RegistryHelp = { title: string; purpose: string };

const legacySkillDescriptions: Record<string, readonly [string, string]> = {
  'knowledge.answer_question': ['Search approved knowledge and answer with evidence references.', '从有权访问的知识库中检索资料，结合来源证据回答问题。适用于查询制度、操作规程、设备手册等已有文档中的信息。'],
  'knowledge.ingest_for_rag': ['Convert uploaded assets into Markdown and searchable chunks.', '用于把上传的文档导入知识库，供后续检索和问答。适用于添加设备手册、制度文件等资料。目前请从知识库页面发起导入。'],
  'knowledge.intake_document_ontology': ['Guide an uploaded document through ontology extraction, review, and graph publication.', '从文档中梳理业务对象及其关系，供人工复核。适用于整理设备、部件等对象之间的关联。目前可检索知识库片段，候选提取和图谱写入工具尚未接通。'],
  'quality.create_capa_draft': ['Prepare a corrective action draft from page context and evidence.', '根据质量问题和已有证据，整理纠正与预防措施并保存为待复核的草稿。适用于处理质量异常、偏差或不合格项。'],
  'maintenance.create_work_order_draft': ['Prepare a work order draft with supporting evidence.', '根据设备信息和故障现象，在现有工单表单中起草维修记录。适用于巡检发现异常或设备报修后，需要先整理工单的场景。'],
  'supply.create_purchase_request_draft': ['Prepare a purchase request draft without creating an external order.', '根据物料、数量、用途和需求时间起草采购申请。适用于补货或新增采购需求，草稿供复核后提交。'],
  'material.create_material_application_draft': ['Prepare a material application draft for human review.', '根据物料标识、数量和用途起草物料申请。适用于领用或申领物料前，先整理一份待复核的记录。'],
  'analysis.analyze_form_records': ['Query permitted dynamic form records and summarize patterns.', '查询有权查看的业务表单记录，归纳趋势、类别分布和异常。适用于按时间、班组或问题类别分析巡检等业务数据。'],
  'forms.create_record_draft': ['Prepare a new dynamic form record draft without submitting it.', '按现有业务表单的字段整理用户提供的信息，经确认后保存一条记录草稿。适用于需要先填写、再复核或提交的登记和申请。'],
  'low_code.suggest_model_or_page': ['Suggest data model, page, or workflow configuration changes as a draft.', '根据业务需求提出数据模型、页面或流程的设计建议。适用于尚在讨论方案，需要明确字段、页面结构或流程节点时。'],
  'low_code.create_form_definition': ['Create a low-code form only after semantic planning and approval.', '根据需求规划字段、控件和布局，生成可复核的表单草稿。适用于新建登记表、申请表，或继续调整当前设计器中的表单草稿。'],
  'low_code.add_form_field': ['Add fields to an existing low-code form after planning and confirmation.', '为现有业务表单准备新增字段，经确认后写入字段配置并同步相关布局。适用于补充字段、控件或字段规则。'],
  'workflow.submit_after_confirmation': ['Submit a prepared draft to workflow only after confirmation.', '用于在用户复核草稿后发起审批。适用于业务记录已准备好、需要进入审批流程时。目前请从对应业务表单提交，审批和通知工具尚未接通。'],
  'low_code.inspect_form': ['Inspect form versions, layouts, rule results and publication impact using shared platform services.', '查看表单布局、历史版本，预演字段规则并检查发布影响。适用于排查表单配置问题，或在发布前确认阻塞项。'],
  'analysis.manage_dashboard': ['复用平台看板来源、指标、权限、草稿与发布能力。', '预览业务数据来源，新建看板草稿，或维护已有看板的指标、布局和筛选。适用于搭建或调整看板，保存和发布需确认。'],
  'analysis.query_dashboard': ['复用平台看板来源、指标、权限、草稿与发布能力。', '按已发布看板的指标口径、数据权限和筛选条件查询结果。适用于查看指定时间、班组或范围内的看板指标。'],
  'low_code.publish_form_to_menu': ['定位已有应用和菜单分组，复核后发布已保存的标准表单并挂载入口。', '将已保存的标准业务表单挂载到指定应用的菜单，经确认后按需发布。适用于表单配置已准备好，需要让业务人员从应用菜单打开时。'],
};

export function getSkillDisplayDescription(name: string, description?: string): string {
  const legacy = legacySkillDescriptions[name];
  return legacy && description === legacy[0] ? legacy[1] : description ?? '';
}

const legacySkillTitles: Record<string, { stored: string; localized: string }> = {
  'analysis.analyze_form_records': { stored: 'Analyze form records', localized: '分析业务记录' },
  'analysis.manage_dashboard': { stored: '管理业务看板', localized: '搭建和维护业务看板' },
  'analysis.query_dashboard': { stored: '查询看板指标', localized: '查询已发布看板' },
  'forms.create_record_draft': { stored: 'Create form record draft', localized: '填写一条业务记录草稿' },
  'knowledge.answer_question': { stored: 'Knowledge Q&A', localized: '根据知识库回答问题' },
  'knowledge.ingest_for_rag': { stored: 'Knowledge ingestion', localized: '导入文档供知识检索' },
  'knowledge.intake_document_ontology': { stored: 'Document ontology intake', localized: '从文档提取图谱对象' },
  'low_code.add_form_field': { stored: 'Add low-code form field', localized: '给现有表单添加字段' },
  'low_code.create_form_definition': { stored: 'Create low-code form', localized: '搭建一张业务表单' },
  'low_code.inspect_form': { stored: 'Inspect form configuration', localized: '检查表单配置和发布影响' },
  'low_code.publish_form_to_menu': { stored: '将业务表单交付到应用菜单', localized: '将业务表单交付到应用菜单' },
  'low_code.suggest_model_or_page': { stored: 'Low-code design suggestion', localized: '提出表单、页面或流程设计建议' },
  'maintenance.create_work_order_draft': { stored: 'Maintenance work order draft', localized: '起草维修工单' },
  'material.create_material_application_draft': { stored: 'Material application draft', localized: '起草物料申请' },
  'quality.create_capa_draft': { stored: 'CAPA draft', localized: '起草质量纠正与预防措施' },
  'supply.create_purchase_request_draft': { stored: 'Purchase request draft', localized: '起草采购申请' },
  'workflow.submit_after_confirmation': { stored: 'Workflow submission', localized: '确认后发起审批' },
};

export function getSkillDisplayTitle(name: string, title?: string): string {
  const legacy = legacySkillTitles[name];
  const saved = title?.trim();
  return legacy && (!saved || saved === legacy.stored) ? legacy.localized : saved || name;
}

const toolEntries: Record<string, [string, string]> = {
  'ai.semantic_plan_low_code_form': ['整理表单设计需求', '把自然语言整理成字段和表单操作计划，供后续设计使用。'],
  'platform.application_settings.query': ['查应用和菜单', '查应用名称、编码和状态。指定应用可查菜单分组、入口和绑定目标。'],
  'platform.form_settings.query': ['查表单和字段', '查业务表单，按 ID 或编码定位表单及有权查看的字段。'],
  'platform.identity_settings.query': ['查用户和角色', '读取本租户的用户和角色信息，用于核对人员和身份配置。'],
  'knowledge.search': ['搜索知识库', '按访问权限搜索可用于问答的文档片段和证据。'],
  'forms.query_records': ['筛选业务记录', '按表单和筛选条件查一批可访问的业务记录。'],
  'forms.get_record': ['读取一条业务记录', '按记录 ID 查看业务记录详情，并遵循字段权限。'],
  'forms.create_dynamic_record_draft': ['新增业务记录草稿', '在已有表单中保存一条草稿，例如巡检记录或采购申请。'],
  'forms.update_record': ['修改业务记录', '确认后只修改已有记录中指定的字段。'],
  'forms.create_form_definition': ['创建表单定义', '确认后将表单、字段和布局保存为草稿。发布或挂载菜单需要单独确认。'],
  'forms.update_definition': ['更新表单定义', '修改表单名称等信息。传入完整配置时会替换原配置。'],
  'forms.copy': ['复制表单配置', '复制表单设计和字段配置，生成独立表单。'],
  'forms.delete': ['删除草稿表单', '删除符合依赖检查的草稿表单，执行受安全策略约束。'],
  'forms.add_form_field': ['新增表单字段', '给现有表单加一个字段和相应控件配置。'],
  'forms.update_field': ['修改字段草稿', '调整已有字段的规则、控件等配置，发布后应用。'],
  'forms.archive_field': ['归档表单字段', '在草稿中归档指定字段，发布后应用。'],
  'forms.get_layouts': ['查看表单布局', '读取表单已有的布局配置。'],
  'forms.save_layout': ['保存表单布局草稿', '用提交的配置替换指定布局的草稿。'],
  'forms.evaluate_rules': ['预演表单规则', '用给定输入计算默认值、公式结果和字段状态。'],
  'forms.preview_publish': ['检查表单发布影响', '预览发布影响及阻塞项，例如历史记录是否满足新规则。'],
  'forms.publish': ['发布表单配置', '把当前表单草稿发布为正式版本。'],
  'forms.publish_to_menu': ['发布表单并挂载菜单', '确认后按需发布标准表单并建立菜单入口。已有发布版本时沿用，重复执行复用已有入口。'],
  'forms.list_versions': ['列出表单发布版本', '查看已发布版本的清单。'],
  'forms.get_version': ['读取表单版本快照', '读取某一个已发布版本的配置。'],
  'forms.restore_draft': ['用已发布版本恢复草稿', '用最近发布的版本覆盖当前草稿，未发布修改会被替换。'],
  'forms.list_actions': ['查看表单动作', '列出表单上已有的业务动作，例如提交按钮。'],
  'forms.create_actions': ['新增表单动作', '为表单新增一项业务动作配置。'],
  'forms.update_actions': ['修改表单动作', '调整已有的业务动作配置。'],
  'forms.delete_actions': ['删除表单动作', '移除指定动作配置。'],
  'forms.list_permissions': ['查看表单权限', '读取表单已有的权限配置。'],
  'forms.create_permissions': ['新增表单权限规则', '为表单新增一项权限规则。'],
  'forms.update_permissions': ['修改表单权限规则', '调整已有的表单权限规则。'],
  'forms.delete_permissions': ['删除表单权限规则', '移除指定权限规则。'],
  'forms.list_workflow_bindings': ['查看表单审批绑定', '查看哪些表单动作关联了审批流程。'],
  'forms.create_workflow_bindings': ['为动作绑定审批流程', '把一个已有审批流程绑定到表单动作。'],
  'forms.update_workflow_bindings': ['修改审批流程绑定', '调整已有的表单动作与流程关系。'],
  'forms.delete_workflow_bindings': ['移除审批流程绑定', '解除指定表单动作与流程的绑定。'],
  'dashboards.preview_source': ['预览看板和业务来源', '用已有表单数据预览指标卡、趋势和排行。'],
  'dashboards.create': ['创建业务看板草稿', '基于已有业务来源创建看板草稿，确认后保存。'],
  'dashboards.get': ['读取业务看板配置', '读取看板草稿、已发布配置和修订号。'],
  'dashboards.save_draft': ['保存看板修改', '按修订号保存看板布局、组件、来源、指标和筛选。'],
  'dashboards.publish': ['发布看板配置变更', '发布已有看板的草稿变更。首次发布使用表单发布工具。'],
  'dashboards.query': ['查询看板指标', '按已发布口径和当前筛选条件计算指标。'],
  'graph.query_impact': ['查询图谱影响', '预留用于查询配置变更影响的图谱对象。'],
  'inventory.get_stock': ['查询库存', '预留用于查询可用库存和安全库存。'],
  'knowledge.ingest_document': ['创建知识导入任务', '预留用于把已上传文件交给知识导入流程。'],
  'knowledge.convert_to_markdown': ['将文件转为 Markdown', '预留用于转换文档、表格、PDF 和图片。'],
  'knowledge.chunk_markdown': ['切分知识文档', '预留用于切分可回溯原文的检索片段。'],
  'knowledge.embed_chunks': ['生成检索向量', '预留用于把检索片段转换为向量。'],
  'knowledge.extract_ontology_candidates': ['提取图谱候选项', '预留用于从文档提取对象、关系及证据。'],
  'knowledge.approve_ontology_candidates': ['批准图谱候选项', '预留用于批准已复核的对象和关系。'],
  'knowledge.commit_ontology_to_graph': ['发布候选项到图谱', '预留用于将批准后的候选对象和关系写入图谱。'],
  'notifications.create': ['创建通知', '预留用于发送草稿或流程状态通知。'],
  'quality.get_event': ['读取质量事件', '预留用于获取整改草稿所需的质量事件详情。'],
  'workflow.start': ['发起审批实例', '预留用于从已确认的记录草稿发起审批。'],
};

export function getToolHelp(name: string): RegistryHelp | undefined {
  const entry = toolEntries[name];
  return entry && { title: entry[0], purpose: entry[1] };
}

export const toolEffects: Record<string, string> = {
  read: '只读', analyze: '分析', draft_write: '保存草稿', record_write: '修改业务记录',
  configuration_write: '修改配置', workflow_action: '操作流程', external_write: '写入外部系统',
};

export function toolAvailability(tool?: { enabled?: boolean; handler_key?: string }) {
  if (!tool) return '未注册';
  if (tool.enabled === false) return '已停用';
  return tool.handler_key === 'not_implemented' ? '待接入' : '已接入';
}
