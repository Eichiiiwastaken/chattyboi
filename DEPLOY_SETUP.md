# Deployment Setup

## Chat rate limits

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | For finite user quotas | Standalone Redis or a cluster-compatible proxy connection string, such as `redis://redis:6379`. Direct Redis Cluster endpoints are not supported. If a finite user quota is configured and Redis cannot enforce it, chat requests fail closed with `503 offline:chat`. |
| `CHAT_MAX_MESSAGES_PER_HOUR` | No | Maximum model-generating chat requests per signed-in user in a one-hour window. Omit it or use a non-positive value for unlimited use. |
| `IP_MAX_MESSAGES_PER_HOUR` | No | Best-effort production-only per-IP request limit. Requires `REDIS_URL`. |

## GitHub Container Registry (GHCR)

Images are built by GitHub Actions on push to `main` and published to `ghcr.io/<owner>/chattyboi`.

### Server Setup

1. **Create a GitHub PAT** at [github.com/settings/tokens](https://github.com/settings/tokens) with `read:packages` scope.

2. **Login to GHCR** on your server:
   ```bash
   echo "YOUR_PAT" | docker login ghcr.io -u YOUR_USERNAME --password-stdin
   ```

3. **Prepare the project directory:**
   ```bash
   mkdir -p /opt/chattyboi
   ```

4. **Copy `docker-compose.yml` and `.env.example`** to the server. Rename `.env.example` to `.env` and fill in your secrets.

5. **Set `CHATTYBOI_IMAGE` in `.env`** to the image published by GitHub Actions:
   ```bash
   CHATTYBOI_IMAGE=ghcr.io/YOUR_USERNAME/chattyboi:latest
   ```

6. **Deploy:**
   ```bash
   cd /opt/chattyboi
   docker compose pull
   docker compose up -d
   docker image prune -f
   ```

### Container Runtime

The supplied Compose service uses a read-only root filesystem and runs the
application as UID/GID `10001`. It keeps only `/tmp` and `/app/.next/cache`
writable as temporary filesystems, while `/app/uploads` remains backed by the
persistent `uploads` volume.

The image entrypoint may recursively repair the uploads volume ownership during
the first start after upgrading from an older root-running image. It then drops
privileges before migrations and the Next.js server start. Do not remove the
`CHOWN`, `SETGID`, or `SETUID` capabilities unless the volume has already been
prepared for UID/GID `10001` and the entrypoint is changed accordingly.

### Optional: Deploy Alias

Add to `~/.bashrc`:
```bash
alias deploy-chatty='cd /opt/chattyboi && docker compose pull && docker compose up -d && docker image prune -f'
```

Then `source ~/.bashrc` and run `deploy-chatty` to update.
