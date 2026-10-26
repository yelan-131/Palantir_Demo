# 从零编写业务表单系统：开发规格与实现指南

更新日期：2026-10-26

界面、现有架构和交互参考见[业务表单定义：现有 UI、架构与交互参考](../README.md)。附六张结构图、四张历史界面参考及可离线打开的 HTML；其中明确区分现有实现与本文的新系统方案。

本文交给需要自行编写系统的开发者。**不要求取得、复制或运行现有项目代码。**目标是根据这里的数据模型、接口和处理规则，独立实现“配置表单 → 保存设计草稿 → 发布版本 → 填写业务记录 → 审批处理”的闭环。

本文是一套新系统的开发规格，不是当前项目接口的逐项说明。文中的路径、表名和 JSON 是这套新系统约定；可以换技术语言，但不要在前后端各自改变契约。

读者应具备 Web 开发、SQL、HTTP 和基本登录鉴权知识。本文提供实现依据和关键伪代码，**不包含可直接运行的完整源码，也不承诺没有编程经验的读者只复制命令就能完成系统。**

## 1. 最终要交付什么

用“设备告警处理单”作为贯穿开发的样例。管理员可以配置标题、等级、描述和处理结论；发布后，业务人员可以新增、查询、编辑并提交告警，审批人可以处理待办。

分两次完成：

### 第一阶段：配置、发布、填写

- 登录和角色识别。
- 新建表单、配置字段及布局。
- 文本、多行文本、整数、小数、布尔、日期、日期时间、静态单选。
- 固定默认值、必填、长度、范围和选项校验。
- 列表列、分页、筛选及排序。
- 表单动作和字段权限。
- 设计草稿、发布预检查、不可变版本快照。
- 新增、编辑、软删除业务记录。
- 审计和错误提示。

### 第二阶段：提交和审批

- 保存未完成的业务草稿。
- 顺序审批、固定审批人、同意和驳回。
- 流程版本快照、待办和记录状态联动。

复杂拖拽、条件分支、会签、附件、外部数据源、计算表达式、导入导出、物理建表、AI 配置和独立组件页面均为后续扩展。第一版界面不要提供尚未实现的开关。

## 2. 技术结构与工程骨架

为使实现步骤具体，本文采用 React + TypeScript 前端、FastAPI + SQLAlchemy 后端、PostgreSQL 数据库。这里是选定的实现方案，不要求与现有项目版本保持一致。

新建自己的工程，选择互相兼容的依赖后锁定版本，提交前端 lockfile 和后端依赖锁定文件。数据库结构统一用 Alembic 迁移，环境配置至少包括数据库连接、登录签名密钥和前端 API 地址。

```text
business-forms/
  backend/
    app/
      main.py
      auth/                 登录、当前身份、角色
      api/                  接口适配、请求和响应
      schemas/              配置、发布、记录的输入输出模型
      models/               SQLAlchemy 模型
      services/
        definitions.py      设计配置校验
        publishing.py       预检查和发布事务
        records.py          记录读写与并发控制
        permissions.py      动作、字段与数据范围
        validation.py       类型、默认值、约束
        workflows.py        第二阶段流程
        audit.py
    migrations/
    tests/
  frontend/
    src/
      pages/                登录、表单管理、设计器、业务页、待办
      components/           字段编辑、控件渲染、列表渲染
      contracts/            与后端一致的 Schema 类型
      services/             HTTP 客户端
  compose.yml
  .env.example
```

HTTP 路由负责接收参数和返回结果，业务服务负责校验、权限和事务。设计器与运行页共用字段类型约定；后端保存时必须再次检查，不能依赖前端校验。

第一阶段只用一套 JSONB 记录存储，不根据表单自动创建数据库表。这样可以先完成版本和运行逻辑，再独立设计物理存储适配。

## 3. 先固定三类数据和状态

### 3.1 设计草稿

管理员正在编辑的整份定义。保存后可以继续修改，不改变线上表单。

### 3.2 已发布快照

发布成功时复制设计草稿，生成一个不可修改的版本。运行页只读取当前发布指针指向的快照。尚未发布时，业务接口返回 `FORM_NOT_PUBLISHED`，不能偷偷使用草稿。

表单身份状态采用 `draft → published → disabled`。已发布表单仍可存在新的设计草稿，保存草稿不把表单状态改回 `draft`。禁用时停止普通运行页读写，管理端仍可查看历史。

### 3.3 业务记录

用户填写的单据，独立于设计草稿。第一阶段状态只有 `draft` 和 `active`；删除使用 `deleted_at`。第二阶段增加 `in_review`、`approved`、`rejected`。

记录绑定创建时的 `schema_version`。本规格采用以下明确策略：

- 新记录使用当前已发布版本。
- 历史记录的详情、编辑和校验使用它绑定的版本，普通编辑不自动升级版本。
- 列表列与筛选使用当前已发布版本；历史记录缺少的新字段显示为空。
- 访问控制始终采用当前已发布权限，不能靠旧版本绕过已经收回的权限。
- 字段键一旦发布，不允许删除或更换类型；可以隐藏，显示名称可以调整。枚举值和必填调整采用第 7 节规则。

这能降低第一版的数据迁移复杂度。以后若要所有旧单据按新规则编辑，应另做显式迁移功能，逐条校验并记录迁移结果。

## 4. 数据库模型

所有业务表都带 `tenant_id`。第一版可以只有一个租户，但当前租户必须从登录身份取得，不能相信客户端传来的租户参数。

先建立 `tenants`、`users`、`roles`、`user_roles`。用户保存密码哈希，禁止明文密码；开发初始化脚本从环境变量读取管理员初始密码。角色通过用户角色关系解析，业务身份不由前端自报。

以下 SQL 定义核心业务表。`created_by`、`updated_by` 对应用户 ID；实现用户表后补上外键。UUID 由应用生成。

```sql
CREATE TABLE forms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code varchar(100) NOT NULL,
  name varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','disabled')),
  published_version integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE form_drafts (
  form_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  definition jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, form_id) REFERENCES forms(tenant_id, id)
);

CREATE TABLE form_versions (
  form_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  definition_hash varchar(64) NOT NULL,
  impact_report jsonb NOT NULL,
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, version),
  UNIQUE (tenant_id, form_id, version),
  FOREIGN KEY (tenant_id, form_id) REFERENCES forms(tenant_id, id)
);

CREATE TABLE form_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  form_id uuid NOT NULL,
  schema_version integer NOT NULL,
  data jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, form_id, schema_version)
    REFERENCES form_versions(tenant_id, form_id, version)
);

CREATE INDEX form_records_list_idx
  ON form_records (tenant_id, form_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action varchar(60) NOT NULL,
  resource_type varchar(40) NOT NULL,
  resource_id uuid NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`forms.published_version` 是运行态唯一发布指针；更新它之前必须已经插入对应快照。可在迁移中追加 `(tenant_id,id,published_version)` 到版本表的复合外键，使用可延迟约束解决循环插入依赖。

快照在服务层禁止更新、删除；进一步可通过数据库权限或触发器限制修改。审计只记录必要变更摘要，敏感字段脱敏，不保存密码和令牌。

## 5. 前后端共用的表单定义

定义必须带 `schemaFormat`，用于未来升级配置格式；它与发布版本号是两回事。第一版只接受 `schemaFormat: 1`。

下面是一份可用于开发联调的完整样例。角色键需要在初始化脚本中创建。

```json
{
  "schemaFormat": 1,
  "fields": [
    {
      "key": "title",
      "label": "告警标题",
      "type": "string",
      "control": "input",
      "required": true,
      "constraints": {"maxLength": 100}
    },
    {
      "key": "level",
      "label": "告警等级",
      "type": "string",
      "control": "select",
      "required": true,
      "default": "normal",
      "options": [
        {"value": "normal", "label": "普通"},
        {"value": "critical", "label": "严重"}
      ]
    },
    {
      "key": "description",
      "label": "告警描述",
      "type": "string",
      "control": "textarea",
      "required": false,
      "constraints": {"maxLength": 2000}
    },
    {
      "key": "resolution",
      "label": "处理结论",
      "type": "string",
      "control": "textarea",
      "required": false,
      "constraints": {"maxLength": 2000}
    }
  ],
  "layout": [
    {"id": "section_basic", "title": "告警信息", "fields": ["title", "level", "description"]},
    {"id": "section_result", "title": "处理信息", "fields": ["resolution"]}
  ],
  "list": {
    "columns": ["title", "level"],
    "filters": [{"field": "level", "operator": "eq"}],
    "defaultSort": {"field": "created_at", "direction": "desc"},
    "pageSize": 20
  },
  "permissions": [
    {
      "role": "reporter",
      "actions": ["view", "create", "edit"],
      "dataScope": "own",
      "fields": {
        "title": {"read": true, "write": true},
        "level": {"read": true, "write": true},
        "description": {"read": true, "write": true},
        "resolution": {"read": true, "write": false}
      }
    },
    {
      "role": "supervisor",
      "actions": ["view", "edit"],
      "dataScope": "all",
      "fields": {
        "title": {"read": true, "write": false},
        "level": {"read": true, "write": false},
        "description": {"read": true, "write": false},
        "resolution": {"read": true, "write": true}
      }
    }
  ],
  "workflow": null
}
```

约定：

- 字段键匹配 `^[a-z][a-z0-9_]{0,63}$`，同一表单不重复。
- 系统键 `id`、`status`、`created_at`、`created_by`、`revision` 不允许成为业务字段。
- 类型限定为 `string`、`integer`、`decimal`、`boolean`、`date`、`datetime`。
- 小数采用十进制字符串传输，用后端 Decimal 校验；整数拒绝布尔值和小数；布尔值只接受 JSON 布尔。
- 日期为 `YYYY-MM-DD`，日期时间为带时区的 RFC 3339 字符串，入库归一化为 UTC。
- 约束明确支持 `minLength/maxLength`、`min/max`、`precision`。第一版不接收任意 JavaScript/Python 表达式。
- 静态选择只接受字符串值，存储 value，显示 label；选项值唯一。
- 未设置默认值时省略 `default`；显式 `null` 与缺少属性分别处理。
- 布局只能引用有效字段，同一字段只能出现在一个输入位置。
- 第一版不支持动态隐藏；必填字段必须在布局中，且目标填写角色可写，或具备合法服务端默认值。
- 限制一张表单最多 100 个字段、一次列表最多 100 条、单条记录序列化后最多 1 MiB。这些是本规格的实现边界。

## 6. 最小接口契约

统一前缀 `/api/v1`。登录后使用 Bearer token；服务端验证签名、有效期和用户状态，然后查询租户与角色。未登录返回 401，无操作权限返回 403；跨租户资源按不存在返回 404。

成功响应为 `{"data": ...}`；列表另含 `meta: {page,pageSize,total}`。错误响应示例：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请检查字段内容",
    "fields": [{"field": "title", "code": "REQUIRED", "message": "告警标题不能为空"}],
    "requestId": "request-uuid"
  }
}
```

### 6.1 身份和设计接口

- `POST /auth/login`：请求 `{username,password}`，返回 `{accessToken,expiresAt}`。
- `GET /auth/me`：返回当前用户 ID、租户、角色及配置管理能力。
- `POST /forms`：管理员创建表单，请求 `{code,name}`，同时写入 revision 为 1 的空设计草稿，返回表单 ID。
- `GET /forms`：返回管理员可配置的表单列表；普通用户只获得可访问的已发布表单。
- `GET /forms/{id}/draft`：管理员取得 `{definition,revision}`。
- `PUT /forms/{id}/draft`：管理员提交 `{definition,expectedRevision}`，成功返回新 revision；冲突返回 409 `DRAFT_CONFLICT`。
- `POST /forms/{id}/publish-preview`：请求 `{expectedRevision}`，返回 `{draftRevision,definitionHash,blocking, warnings,recordCount}`。
- `POST /forms/{id}/publish`：请求 `{expectedRevision,definitionHash}`，重新检查并发布，返回 `{version,publishedAt}`。
- `GET /forms/{id}/versions`：管理员查看版本摘要；`GET /forms/{id}/versions/{version}` 返回只读快照。
- `GET /forms/{id}/runtime`：读取发布快照，并返回按当前身份裁剪后的字段、布局、列表和有效动作；不向普通用户返回整份角色权限配置。

保存设计草稿先校验 JSON 形状、字段类型和大小；允许布局暂时不完整，并返回设计问题列表。发布时必须通过全部完整性检查。这让用户可以保存未做完的设计。

### 6.2 记录接口

- `POST /forms/{id}/records`：请求 `{data,intent}`；intent 仅允许 `saveDraft` 或 `save`，分别生成 `draft` 或 `active`。
- `GET /forms/{id}/records`：参数 `page`、`pageSize`、`filters`、`sortField`、`sortDirection`；filters 使用 URL 编码的 JSON 数组。
- `GET /forms/{id}/records/{recordId}`：返回裁剪后的记录，以及该记录所绑定版本的有效字段定义。
- `PATCH /forms/{id}/records/{recordId}`：请求 `{data,expectedRevision,intent}`；data 是局部变更，按字段键合并。`null` 表示显式清空，不表示删除属性。
- `DELETE /forms/{id}/records/{recordId}`：请求携带 `expectedRevision`，设置软删除时间，同时递增 revision。

记录响应包含 `{id,schemaVersion,revision,status,data,createdAt,updatedAt}`。客户端不能设置创建人、租户、版本号或任意 status。第二阶段增加专用提交、审批接口，不允许靠 PATCH status 绕过状态机。

固定错误码：422 表示配置或字段无效；409 表示版本、状态或并发冲突；403 表示权限不足；404 表示资源不可访问；503 表示数据库等必需依赖不可用。运行接口没有发布版本时返回 409 `FORM_NOT_PUBLISHED`，禁用时返回 409 `FORM_DISABLED`。

## 7. 发布逻辑：必须在一笔事务里完成

预检查用于给用户展示影响，不授予发布资格。正式发布重新检查当前草稿和数据，防止检查完成后配置或数据被修改。

```python
def publish(actor, form_id, expected_revision, expected_hash):
    require_config_admin(actor)
    with transaction():
        form = lock_form(actor.tenant_id, form_id)  # SELECT ... FOR UPDATE
        draft = get_draft(form.id)
        assert_revision(draft, expected_revision)
        definition = normalize_and_validate(draft.definition)
        assert_hash(canonical_hash(definition), expected_hash)
        report = check_design_and_existing_records(form, definition)
        if report.blocking:
            raise PublishBlocked(report)
        version = (form.published_version or 0) + 1
        insert_immutable_version(form, version, definition, report, actor)
        update_published_pointer(form, version, status="published")
        append_audit(actor, "form.publish", form.id, {"version": version})
    return version
```

草稿保存、记录新增/修改/删除、发布都必须先锁定同一表单行，统一锁顺序为“表单 → 草稿或记录”。如此发布检查期间不会插入逃过检查的新记录。第一版可以接受单表单写入串行，后续再按吞吐量优化。

canonical hash 为字段排序稳定、对象键排序稳定、编码固定的 JSON 的 SHA-256，前后端不要各自使用不同规范。hash 由服务端计算和比较。

必须检查：

- 字段标识、类型、控件兼容关系、布局绑定和列表引用有效。
- 默认值本身通过字段校验；选项值唯一。
- 发布后的字段键不能删除、更名或换类型；隐藏字段可保留在定义中。
- 从可选改成必填，或新增必填字段时，所有非删除记录都具有合法值，否则阻断。包括草稿，第一版采用保守检查。
- 删除枚举值时，没有非删除记录仍使用它，否则阻断。
- 收紧长度、范围、精度时，历史值必须满足新约束，否则阻断。
- 权限角色真实存在，字段引用有效，目标创建角色能完成必要填写。

预检查返回结构化问题：`{code,field,message,affectedCount}`。发布失败时回滚版本写入、发布指针和审计，线上仍使用原版本。版本号增加而定义相同可以允许，暂不做自动合并。

## 8. 记录写入、权限与查询

### 8.1 权限规则

本规格第一版采用默认拒绝、显式允许。多角色动作和字段能力取允许集合的并集，数据范围 `all` 大于 `own`；不引入 deny，避免未定义的冲突优先级。

- `view/create/edit/delete` 分别检查，不把 view 当成可写。
- `own` 仅允许 `created_by == actor.id` 的记录；所有列表、详情、更新、删除均使用同一范围检查。
- 字段缺少授权就是不可见、不可写；write 必须同时具备 read。
- 历史版本中存在但当前版本已隐藏或未授权的字段不返回、不接收更新。
- 创建时不可写字段只能由服务端默认值赋值；客户端传入即拒绝，不能静默忽略。
- 第一版的配置管理员仍通过业务权限访问记录，不自动拥有全部业务数据权限。初始化管理员需要另分配测试业务角色。

### 8.2 保存顺序

```python
def save_record(actor, form_id, patch, intent, expected_revision=None):
    with transaction():
        form = lock_form(actor.tenant_id, form_id)
        require_runtime_enabled(form)
        permissions = current_published_permissions(form, actor)
        record = lock_record_if_editing()
        require_action_and_scope(permissions, record)
        if record:
            assert_revision(record, expected_revision)
        schema = record_schema(record) if record else current_schema(form)
        reject_unknown_and_nonwritable_keys(schema, permissions, patch)
        candidate = merge_patch(record.data if record else {}, patch)
        if not record:
            candidate = apply_missing_defaults(schema, candidate)
        validate_present_values(schema, candidate)
        if intent == "save":
            validate_required_fields(schema, candidate)
        enforce_record_size(candidate)
        persist_with_next_revision(candidate)
        append_redacted_audit()
```

仅对新记录中缺失的键应用默认值，不能在编辑时覆盖旧值，也不能覆盖显式 null。默认值由后端负责，前端预填只是体验。

保存业务草稿可以缺少必填项，但已经填写的值仍要通过类型、枚举、范围等检查。保存 active 记录必须完整校验；第二阶段进入审批后的记录不允许普通编辑。

### 8.3 列表查询

先约束 tenant、form、非删除状态和数据范围，再执行已授权字段的筛选、排序和分页。total 必须使用同一权限条件计算，不能泄露隐藏记录数量。

第一版只支持文本 `eq/contains`、枚举与布尔 `eq`、数值和日期 `eq/gte/lte`。未知字段或不适用的操作符返回 422，不拼接客户端原始 SQL。

动态 JSON 键先在发布字段白名单内验证，再通过 SQLAlchemy JSON 表达式生成查询。排序只允许已配置、当前可读的字段以及 `created_at`；系统时间排序还要用 ID 作稳定的次排序。空值排最后。

小数按数据库 numeric 比较，日期时间按时间值比较，不能把所有 JSON 文本都按字典序排序。日期、小数的安全转换基于已经通过校验的数据。

## 9. 前端按这五个页面编写

### 9.1 登录页

登录成功后取得当前身份；HTTP 客户端统一附带 token。401 返回登录页，403 显示无权限。不要用浏览器传来的角色名作为后端授权依据。

### 9.2 表单管理页

列出表单名称、编码、状态和线上版本。创建表单后进入设计器。编码创建后固定，第一版不做改码和复制。

### 9.3 设计器

先实现增删字段、上下移动和表单属性编辑，再考虑拖拽。页签包括“字段与布局”“列表与筛选”“权限”“发布”。

前端用一个 definition 对象作为当前草稿源；另存服务端 revision 和 dirty 状态。保存携带 expectedRevision；遇到冲突提示重新加载或人工合并，禁止静默覆盖他人的设计。

试填用当前内存草稿调用同一个 FieldRenderer，只修改预览状态，不调用记录写入接口。预览能验证交互，真实权限仍以运行接口为准。

### 9.4 发布确认和版本页

点击发布先保存草稿，再调用预检查；确认窗展示受影响记录数、阻断项和提醒。存在阻断项时禁止确认。

确认时发送服务器返回的 revision 和 hash。成功后读取发布版本及 runtime 验证；失败时保留编辑内容，展示可操作错误。第一版历史版本只读，不提供“回滚数据”按钮。

### 9.5 业务运行页

加载 `/runtime`，按 layout 和字段定义生成表单，按 list 配置生成列表。控件注册映射为 `input/textarea/select/number/switch/date/datetime`，未知控件显示配置错误。

只渲染授权字段，按钮取自有效动作。编辑详情使用记录接口返回的绑定版本字段；保存提交局部可写变更及 revision，发生冲突时要求重新加载，不能自动重试覆盖。

第一版直接通过 `/forms/:id/records` 前端路由进入业务页，并提供“可访问表单列表”导航。应用装配和独立菜单管理作为后续扩展，不作为跑通闭环的前置条件。

## 10. 第二阶段：加入最小审批

顺序审批使用版本快照内的配置：

```json
{
  "workflow": {
    "steps": [
      {"key": "review", "label": "主管审核", "assigneeUserId": "实际用户UUID"}
    ]
  }
}
```

发布检查必须确认所有审批人都属于当前租户且账号有效。权限动作扩展为 `submit`、`approve`。第一版只支持固定人员顺序审批，暂不接受任意流程图。

新增三张表：

- `workflow_instances`：id、tenant_id、form_id、record_id、schema_version、workflow_snapshot、current_step、status、revision。
- `workflow_tasks`：id、tenant_id、instance_id、step_key、assignee_id、status、decision、comment、handled_at；同实例同一步只允许一个任务。
- `idempotency_keys`：tenant_id、actor_id、operation、key、request_hash、response；前四项唯一，与业务变更在同一事务保存。

实例与记录建立同租户复合外键。审批意见最多 2000 字，任务状态限定 `pending/approved/rejected`，实例状态限定 `running/approved/rejected`。

接口：

- `POST /forms/{id}/records/{recordId}/submit`：请求 `{expectedRevision}`，要求 submit 权限。
- `GET /tasks?status=pending`：只返回分配给当前用户的任务。
- `POST /tasks/{taskId}/decision`：请求 `{decision,comment,expectedRevision}`；revision 指任务所属实例的版本，列表和详情应返回该值。

两个写接口都要求 `Idempotency-Key`。同 key 同请求返回原结果，同 key 不同请求返回 409；与记录 revision 配合防止双击提交创建两个流程。

提交事务：锁表单 → 锁记录 → 校验 revision、当前 submit 权限和记录状态 → 按绑定版本完整校验 → 复制流程快照 → 创建实例和首个待办 → 单据设为 in_review → 递增 revision → 写审计和幂等结果 → 提交。

审批事务：先定位所属表单，再按“表单 → 记录 → 实例 → 任务”锁定；重新检查任务分配人、当前 approve 权限、任务状态和实例 revision。通过时推进下一步；最后一步通过设为 approved；驳回设为 rejected，并同步单据状态。

规则：仅 `draft/active/rejected` 可提交，且不得已有 running 实例；`in_review/approved` 不允许普通编辑或删除。驳回后可编辑并再次提交，生成新的实例，旧实例保留。

审批执行采用实例快照，不读取管理员正在修改的流程草稿。流程版本更新后，在途实例继续按原快照执行；实时权限仍可阻止已被撤权的人员操作。第一版遇到审批人停用时明确报错，由管理员处理，不自动放行。

## 11. 按里程碑开发，每步有验收

### M1：空工程能启动并登录

建立工程、配置、迁移、用户角色、登录和 health 接口。提供空数据库迁移和创建测试账号命令。验收：数据库正常时 health 成功；无 token 调用受保护接口返回 401；跨租户访问返回 404。

### M2：能保存设计草稿

实现表单创建、definition 契约及设计器字段编辑。验收：刷新可恢复配置；两个浏览器基于同 revision 保存，后保存者收到 409；运行接口仍提示未发布。

### M3：能发布并读取快照

实现预检查、发布事务和版本页。验收：第一次发布得到 v1；修改草稿后 runtime 仍是 v1；再次发布后为 v2；人为制造发布写入失败，不能留下半完成版本。

### M4：能生成表单并保存记录

实现 FieldRenderer、后端验证、列表、编辑、软删除。验收：非法枚举被拒绝；业务草稿可以缺少必填项；正式保存不能；局部更新不丢失未提交字段；并发更新返回冲突。

### M5：权限和版本边界正确

建立 reporter、supervisor 两类账号。验收：reporter 只看到自己的记录；直接调用 API 也不能写 resolution；隐藏字段不出现在响应和筛选中；历史记录按绑定版本编辑，权限采用当前版本。

### M6：完整发布与升级演练

用样例定义发布 v1 并新增至少两条记录。新增必填字段但不给历史记录赋值，发布必须阻断；改为可选后可发布 v2。将原字段收紧到不兼容历史值，检查必须报出字段与影响数量。

### M7：审批闭环

增加顺序流程。验收：提交产生一个实例和一个待办；重复相同幂等请求不重复创建；非处理人无法审批；通过、驳回和驳回后重提符合状态规则；发布新流程不改变在途实例。

每一阶段补服务层和真实数据库集成测试，特别验证事务、锁和 JSON 查询；不要只用假数据库对象证明并发安全。界面测试至少覆盖“配置 → 发布 → 填写 → 查询”和“提交 → 待办 → 审批”。

## 12. 扩展时需要补什么

- **自动编码**：独立计数器表、唯一约束、事务分配；不要用记录数量加一生成编码。
- **动态选项**：受控来源适配、分页和权限、服务端验证选项有效性；不接受客户端提供的任意数据库或 URL。
- **计算和联动**：受限表达式树、依赖图、循环检测、后端重算；不执行配置里的原始脚本。
- **附件**：独立文件元数据、持久存储、大小与类型限制、上传及下载权限、失效清理。
- **导入导出**：复用记录权限和校验，限制资源消耗，逐行错误报告；不得另开绕过授权的写入路径。
- **物理存储**：在记录服务后增加存储适配器，再设计 DDL、迁移、恢复及历史字段保留策略。
- **独立组件页面**：另建页面草稿和页面版本，明确页面布局发布与来源表单发布相互独立。
- **历史数据升级**：显式迁移计划、预检查、分批执行、冲突策略、日志和可恢复方案。

## 13. 交给另一位开发者时，一并交付这些内容

本文可以作为开发说明交付。接收者应据此编写自己的代码；完成后，交付物至少包括：

- 源码及依赖锁定文件。
- 空数据库迁移与测试账号初始化脚本。
- 不含真实密钥的 `.env.example`。
- 启动前端、后端和数据库的明确命令及端口说明。
- 自动生成的 OpenAPI、本文约定的样例 definition、角色与测试数据。
- M1～M7 验收用例和实际通过记录。
- 已实现能力与未实现扩展清单。

**完成标准是：另一位开发者在空数据库、独立配置和自己的账号下，可以从新建表单走到发布、录入、查询及审批，并通过权限、版本和并发验收。**展示一个能拖拽控件的页面，还不能证明系统已经完成。
