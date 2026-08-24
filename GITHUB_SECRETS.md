# GitHub secrets

No manual GitHub Secrets are required.

The deploy workflow (`.github/workflows/deploy.yml`) uses the built-in `GITHUB_TOKEN` with `packages: write` permission to push images to GHCR.

The only credential needed is a GitHub PAT with `read:packages` scope on your server for `docker login ghcr.io`.
