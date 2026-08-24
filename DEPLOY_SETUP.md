# Deployment setup

## Chat rate limits

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | For finite user quotas | Standalone Redis or a cluster-compatible proxy connection string, such as `redis://redis:6379`. Direct Redis Cluster endpoints are not supported. If a finite user quota is configured and Redis cannot enforce it, chat requests fail closed with `503 offline:chat`. |
| `CHAT_MAX_MESSAGES_PER_HOUR` | No | Maximum model-generating chat requests per signed-in user in a one-hour window. Omit it or use a non-positive value for unlimited use. |
| `IP_MAX_MESSAGES_PER_HOUR` | No | Best-effort production-only per-IP request limit. Requires `REDIS_URL`. |

## GitHub Container Registry (GHCR)

When code reaches `main`, GitHub Actions builds the image and publishes it to `ghcr.io/<owner>/chattyboi`.

### Server setup

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

### Container runtime

The Compose service uses a read-only root filesystem and runs the application
as UID/GID `10001`. It mounts `/tmp` and `/app/.next/cache` as writable temporary
filesystems. The persistent `uploads` volume backs `/app/uploads`.

After an upgrade from an older root-running image, the entrypoint may repair
ownership throughout the uploads volume. It then drops privileges before it
runs migrations and starts Next.js. Keep the `CHOWN`, `SETGID`, and `SETUID`
capabilities unless you have prepared the volume for UID/GID `10001` and changed
the entrypoint to match.

### Optional deploy alias

Add to `~/.bashrc`:
```bash
alias deploy-chatty='cd /opt/chattyboi && docker compose pull && docker compose up -d && docker image prune -f'
```

Then `source ~/.bashrc` and run `deploy-chatty` to update.
