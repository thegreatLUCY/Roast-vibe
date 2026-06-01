# DevContainer — Linux env for Workers runtime

This project's local dev runtime (`workerd`) requires macOS 13.5+ or Linux (glibc 2.35+). If you're on an older macOS, develop inside this container instead.

## One-time setup

1. Install [VS Code](https://code.visualstudio.com/) and the **Dev Containers** extension (`ms-vscode-remote.remote-containers`).
2. Make sure Docker Desktop is running.
3. Open the project folder in VS Code.
4. Command Palette → **Dev Containers: Reopen in Container**. First build takes 2–4 minutes; subsequent opens are seconds.

## What the container has

- Debian Bookworm + Node 24 (glibc 2.36, satisfies workerd's requirement)
- `npm install` runs automatically on first create
- Port 8787 (wrangler dev) forwarded to your Mac
- `node_modules` lives in a Docker volume (faster I/O than a bind mount)
- VS Code extensions for ESLint, Prettier, Tailwind preinstalled inside the container

## Inside the container

```bash
npx wrangler login    # opens a browser link on your Mac
npm run dev           # http://localhost:8787 on your Mac
```

Secrets in `.dev.vars` are read from the bind-mounted project folder, so creating `.dev.vars` on your Mac works the same as inside the container.

## CLI-only alternative (no VS Code)

If you'd rather not use VS Code:

```bash
docker run --rm -it \
  -v "$PWD":/workspace -w /workspace \
  -p 8787:8787 \
  mcr.microsoft.com/devcontainers/javascript-node:24-bookworm \
  bash
```

Then inside the shell: `npm install`, `npx wrangler login`, `npm run dev`.
