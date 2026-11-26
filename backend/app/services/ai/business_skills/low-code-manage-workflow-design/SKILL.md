---
name: low-code-manage-workflow-design
description: "读取、校验、保存和发布表单审批流程。适用于设置起止事件、审批人、条件分支、自动任务、抄送、开始节点触发入口，以及连线拐点和注释布局。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.manage_workflow_design"
---

# 搭建和维护表单审批流程

1. 按用户指定的应用核对目标业务表单，未指定时参考已核实的当前应用和设计器上下文。用 `platform.form_settings.query` 确认表单 ID 或编码。目标不明确且有多个候选时请用户选定。需要确认用户或角色时，用 `platform.identity_settings.query`。用 `forms.get_workflow_design` 读流程和 `revision`。已有流程时从读到的设计继续，保留其他配置。
2. 用 `nodes` 和 `edges` 提交流程图。旧流程只返回 `steps` 时，转换时保留原有步骤顺序和处理人。至少有一个开始事件和一个结束事件，每个起点都要连到结束事件。多条分支经过条件网关，非默认分支使用实际表单字段配置条件。并行网关与汇聚网关当前无法执行。
3. 启用读取工具返回的 `trigger_action`，并用 `startNodeId` 绑定开始事件。普通表单使用 `submit`，物料申请使用 `manual_submit`。为审批节点的出线设置 `approvalOutcome`，用 `approve` 表示通过、`reject` 表示驳回。每个审批节点配置一条通过线，按需加一条驳回线。兼容旧流程的未标记出线视为通过。审批任务配置处理人，抄送任务配置已确认的用户或角色。自动任务涉及其他表单时，先核对目标表单和字段映射。
4. 同意后沿通过连线继续。驳回默认沿实际来路退到上一个审批节点或开始事件。需要指定目标时，用审批节点的 `rejectionTargetId` 引用直接相连的前置节点，优先于专用驳回连线。退回审批节点会产生新待办，退回开始事件会交回发起人。调整布局时保留节点 ID、连线端口和已有拐点。审批人、抄送收件人和下发字段映射的每一行也要有 ID，以便在设计器中编辑。注释使用 `annotations`，成员用 `nodeIds` 引用本流程的节点。可保留或调整标题、颜色、`titleStyle`、`frameStyle` 和 `size`。注释和坐标用于画布显示，不参与审批流转。
5. 调用 `forms.validate_workflow_design`。说明已通过的检查或实际返回的阻塞项。用户要保存时，调用 `forms.save_workflow_draft`，传完整设计和读取时的 `expected_definition`，无已存流程时传 null。出现确认卡后结束本轮等待确认。若版本冲突，重新读取并复核修改。
6. 仅在用户明确要求发布后，读取并核对已保存的草稿 ID 和版本，再调用 `forms.publish_workflow_draft`。发布将应用流程和当前表单配置，需要单独确认。回复说明实际应用和表单、流程版本及草稿或发布状态，以实际回执为准。

## 使用示例

> 为异常台账搭建审批流程。提交后由值班主管审核，通过后抄送质量角色，再归档。请先保存草稿。
