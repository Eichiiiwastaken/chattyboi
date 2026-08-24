<img alt="chattyboi" src="app/(chat)/opengraph-image.png">
<h1 align="center">chattyboi</h1>

<p align="center">
    chattyboi is a self-hosted AI chat app built with Next.js, Auth.js, PostgreSQL, Redis, and the AI SDK.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
- [AI SDK](https://ai-sdk.dev/docs/introduction) with unified API for LLMs
- [shadcn/ui](https://ui.shadcn.com) components with [Tailwind CSS](https://tailwindcss.com)
- [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for chat history and user data
- [Vercel Blob](https://vercel.com/storage/blob) for file storage
- [Auth.js](https://authjs.dev) authentication
- Web search and multi-pass deep research with Exa or Tavily, including
  extracted source content and inline citations

## Model providers

chattyboi uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access several AI models through one interface. `lib/ai/models.ts` defines the models and their provider routes. The default list includes Mistral, Moonshot, DeepSeek, OpenAI, and xAI.

`lib/ai/providers.ts` configures OpenCodeGo and OpenRouter directly.

## Local development

The local development stack uses disposable development credentials and
dependency containers that are separate from the production Compose setup.

```bash
pnpm install
pnpm dev:setup
pnpm dev
```

Open `http://localhost:3000` and sign in with `local-dev` for both the username
and password. The values in `.env.development` are intentionally local-only;
production still requires its own `AUTH_SECRET`, `ALLOWED_USERS`, and database
configuration.

To stop the local Postgres and Redis containers:

```bash
pnpm dev:services:down
```

## Deployment

Docker Compose runs chattyboi. GitHub Actions builds the image and pushes it to GitHub Container Registry.

### Prerequisites

- A GitHub account
- [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/) on your server
- A GitHub Personal Access Token (classic) with `read:packages` scope

### Setup

**1. Fork this repository**

**2. Run the GitHub Actions workflow**

Pushing to `main` triggers `.github/workflows/deploy.yml`. The workflow builds a multi-architecture Docker image and pushes it to GHCR with the built-in `GITHUB_TOKEN`. You do not need to configure a separate GitHub Actions secret.

**3. Create your environment file**

```bash
cp .env.example .env
```

Edit `.env` with your API keys and secrets. See the comments in `.env.example` for details.

**4. Login to GHCR on your server**

```bash
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

**5. Set the image in `.env`**

```bash
CHATTYBOI_IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/chattyboi:latest
```

**6. Start the services**

```bash
docker compose up -d
```

The app will be available at `http://localhost:3232`.

### Fixing an existing Postgres volume

Postgres only applies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` when its data directory is first initialized. If the app logs `Role "chattyboi" does not exist`, your existing `pgdata` volume was created with different credentials.

For an empty database, the simplest fix is to recreate the Postgres volume:

```bash
docker compose down
docker volume rm chattyboi_pgdata
docker compose up -d
```

If you need to keep existing data, create the missing role and grant it access instead:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE ROLE chattyboi WITH LOGIN PASSWORD '\''change-me'\'';"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "GRANT ALL PRIVILEGES ON DATABASE chattyboi TO chattyboi;"'
```

### Updating

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

### Local Docker build

To build the app image from your local checkout instead of pulling from GHCR:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

### Container security and uploads

The app container runs its long-lived processes as UID/GID `10001`. It uses a
read-only root filesystem and enables `no-new-privileges`. The container keeps
only the capabilities needed to initialize the uploads volume and drop
privileges. Compose mounts `/tmp` and `/app/.next/cache` as `tmpfs` storage and
stores uploaded files in the `uploads` volume.

On startup, the entrypoint repairs ownership of an existing uploads volume when
needed, then starts the migration and app processes as the unprivileged `app`
user. The first start after upgrading an older root-running deployment may take
longer because the entrypoint must migrate the existing ownership. Keep
`/app/uploads` writable and persistent if you customize the Compose
configuration.
