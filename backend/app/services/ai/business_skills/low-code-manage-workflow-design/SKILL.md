---
name: low-code-manage-workflow-design
description: "读取、校验、保存和发布表单审批流程。适用于设置起止事件、审批人、条件分支、自动任务、抄送、开始节点触发入口，以及连线拐点和注释布局。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.manage_workflow_design"
---

# 搭建和维护表单审批流程

1. 核对当前业务表单。需要查找表单或字段时，用 `platform.form_settings.query`。需要确认用户或角色时，用 `platform.identity_settings.query`。用 `forms.get_workflow_design` 读流程和 `revision`。已有流程时从读到的设计继续，保留用户没要求更改的配置。
2. 用 `nodes` 和 `edges` 提交流程图。旧流程只返回 `steps` 时，转换时保留原有步骤顺序和处理人。至少有一个开始事件和一个结束事件，每个起点都要连到结束事件。多条分支经过条件网关，非默认分支使用实际表单字段配置条件。并行网关与汇聚网关当前无法执行。
3. 启用读取工具返回的 `trigger_action`，并用 `startNodeId` 绑定开始事件。普通表单使用 `submit`，物料申请使用 `manual_submit`。审批通过等结果通过流程内的连线表达。审批任务配置处理人，抄送任务配置已确认的用户或角色。自动任务涉及其他表单时，先核对目标表单和字段映射。
4. 调整布局时保留节点 ID、连线端口和已有拐点。审批人、抄送收件人和下发字段映射的每一行也要有 ID，以便在设计器中编辑。注释使用 `annotations`，成员用 `nodeIds` 引用本流程的节点。可保留或调整标题、颜色、`titleStyle`、`frameStyle` 和 `size`。注释和坐标用于画布显示，不参与审批流转。
5. 调用 `forms.validate_workflow_design`。说明已通过的检查或实际返回的阻塞项。用户要保存时，调用 `forms.save_workflow_draft`，传完整设计和读取时的 `expected_definition`，无已存流程时传 null。出现确认卡后结束本轮等待确认。若版本冲突，重新读取并复核修改。
6. 仅在用户明确要求发布后，读取并核对已保存的草稿 ID 和版本，再调用 `forms.publish_workflow_draft`。发布将应用流程和当前表单配置，需要单独确认。保存或发布后以实际工具结果作为回执。

## 使用示例

> 为异常台账搭建审批流程。提交后由值班主管审核，通过后抄送质量角色，再归档。请先保存草稿。
