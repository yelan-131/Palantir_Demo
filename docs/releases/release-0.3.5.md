# ManuFoundry 0.3.5 Release Notes

Release date: 2026-05-29

## Theme

0.3.5 strengthens the AI Agent action loop and the low-code workspace. The release focuses on making generated configuration actions easier to review, execute, test, and deploy consistently across local development, GitHub, and the production server.

## Highlights

- Added AI action drafts, action state tracking, and structured action payload handling.
- Improved Agent skills, tool registration, intent routing, and policy checks for low-code configuration workflows.
- Upgraded form settings for fields, views, menu nodes, and publish-oriented configuration.
- Added a system administration entry for reference data management.
- Kept the release popup visible after refresh and allowed longer update lists to scroll.
- Expanded private deployment, rollback, doctor, and production smoke-test documentation and scripts.

## Changes

- Added database migrations for AI drafts and menu node configuration.
- Added backend services for action payloads, action state, dynamic record drafts, and intent routing.
- Improved AI Assistant API behavior around action confirmation, execution state, and contextual guidance.
- Refined graph, application, form, and quality APIs so dynamic pages and impact analysis receive steadier scoped data.
- Updated the AI chat widget with richer action review states and production-facing styling.
- Improved workspace, dynamic page, form settings, quality impact, account center, and system admin UI flows.
- Refreshed demo knowledge assets for CAPA, SMT, supplier 8D, and customer communication scenarios.
- Added GitHub workflow and private deployment examples for safer release checks.
- Updated local run scripts and frontend Docker build settings for closer parity with the server.
- Extended tests for AI Agent services, knowledge APIs, and low-code action execution.

## Verification Targets

- Backend AI Agent focused tests pass.
- Frontend production build completes.
- Server Docker Compose rebuilds backend and frontend.
- Production health endpoint returns healthy.
- Release endpoint returns version `0.3.5`.
