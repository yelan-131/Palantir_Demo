# Project Collaboration Notes

- When the user asks to "更新服务器", "把服务器更新", "同步到服务器", or similar, treat it as a request to deploy the current project updates to the configured server.
- Deployment flow for this project:
  1. Commit and push local changes to GitHub.
  2. SSH to the server as `root@111.229.172.100` using the configured private key.
  3. Update the server repository from GitHub, preserving unrelated server-local deployment files unless the user explicitly asks to overwrite them.
  4. Rebuild and restart the affected Docker Compose services under `/root/Palantir_Demo`.
  5. Verify the public frontend and backend health endpoint after deployment.
- The production frontend listens on host port `80`; the frontend container should listen on container port `80`.
