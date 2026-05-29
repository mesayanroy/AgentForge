# Runner Docker Image

This directory contains a small Docker image for running the local runner in an isolated container.

Build the image from the repository root:

```bash
docker build -t agentforge-runner:dev -f runtime/runner/Dockerfile .
```

Run an agent inside the image (mounts the repository into `/workspace`):

```bash
docker run --rm -v "$PWD":/workspace -w /workspace agentforge-runner:dev node -e "require('child_process').execSync('npx ts-node --project tsconfig.json runtime/runner/index.ts agent-1 \"Analyze market\"',{stdio: 'inherit'})"
```

Notes:

- This image is intended for local development and prototyping. For CI or production, compile the runner to JS and build a smaller image with only runtime dependencies.
- The image installs dependencies at build-time using `pnpm`. Ensure your `pnpm-lock.yaml` is up to date.
 - This image is intended for local development and prototyping. For CI or production, use the `Dockerfile.prod` image which contains a tiny HTTP-based runner:

Build the production runner image:

```bash
docker build -t agentforge-runner:prod -f runtime/runner/Dockerfile.prod .
```

Run the prod runner (it will call the local API at `http://host.docker.internal:3000` by default):

```bash
docker run --rm agentforge-runner:prod agent-1 "Analyze market"
```
