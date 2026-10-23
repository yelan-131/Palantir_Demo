export interface PreviewFieldPermission {
  visible: boolean;
  editable: boolean;
  required: boolean;
}

// Node and role restrictions both apply; neither may restore a denied field.
export function previewFieldPermission(
  node: PreviewFieldPermission | undefined,
  role: PreviewFieldPermission | undefined,
  canView = true,
  canFill = true,
): PreviewFieldPermission {
  const visible = canView && node?.visible !== false && role?.visible !== false;
  return {
    visible,
    editable: visible && canFill && node?.editable !== false && role?.editable !== false,
    required: visible && Boolean(node?.required || role?.required),
  };
}

export function previewFlowNodes<T extends { executable: boolean; type: string }>(nodes: T[], associated: boolean): T[] {
  return associated ? nodes.filter(node => node.executable || node.type === 'startEvent' || node.type === 'endEvent') : [];
}
