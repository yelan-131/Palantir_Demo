"""Evaluate per-object approval policies against the membership pinned at assignment."""


def evaluate_approval_groups(groups: list[dict], approvals: list) -> tuple[bool, list[int]]:
    approved = {row.approver_id for row in approvals if row.action == 'approve'}
    outstanding: set[int] = set()
    for group in groups:
        members = set(group['user_ids'])
        satisfied = bool(members) and (
            members <= approved if group['mode'] == 'countersign' else bool(members & approved)
        )
        if not satisfied:
            outstanding.update(members - approved)
    # Empty groups are invalid, rather than an automatic approval.
    complete = bool(groups) and all(group['user_ids'] for group in groups) and not outstanding
    return bool(complete), sorted(outstanding)
