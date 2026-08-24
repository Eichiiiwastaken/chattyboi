# Repository agent instructions

## Local development and UI inspection

- For UI work, run the real application and inspect the result in a browser. Do
  not stop at linting, type-checking, or a missing production secret.
- Run `pnpm dev:setup` once to start the local Postgres and Redis containers and
  apply migrations, then run `pnpm dev`.
- Open `http://localhost:3000` and sign in with `local-dev` as both the username
  and password. These credentials and the values in `.env.development` are for
  local development only.
- AI provider keys are not required to inspect the authenticated application
  shell. They are required only for model-backed generation.
- Check relevant responsive states when changing layout or styling.
- `pnpm dev:services:down` stops the local dependency containers without
  deleting their volumes.

## Website hosting and deployment

- Default every website, web app, dashboard, or similar artifact to local-only
  development and testing.
- Never deploy, publish, or host anything through ChatGPT, OpenAI Sites, or any
  other ChatGPT/OpenAI-managed hosting service unless the user explicitly
  requests that exact hosting option in the current request.
- A general request to make, deploy, publish, or host a website does not
  authorize ChatGPT/OpenAI-managed hosting.
- When hosting is requested without a named destination, prefer the user's own
  server and ask for the target and access details if they are not already
  available.
- Deploy to the user's own server only when the user explicitly requests
  deployment and has provided or approved the necessary target and access
  scope.
