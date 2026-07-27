# Huly integration

Connects NanoClaw to a [Huly](https://huly.io) workspace so agents can:

- **be reached from Huly chat** — a channel adapter (`src/channels/huly.ts`) polls
  the chunter channels the bot is a member of and routes messages to the agent;
  replies are posted back into the channel;
- **read and write issues, todos, and documents** — a bundled first-party MCP
  server (`container/agent-runner/src/huly-mcp/`) exposing `huly_*` tools to
  every agent container.

Both halves authenticate with the same bot token and are enabled purely by the
presence of three `.env` keys — leave them unset and nothing Huly-related loads.

## 1. Create the bot user in Huly

In the Huly UI, invite a user for the bot (e.g. `nanoclaw@yourdomain`). Note its
**account UUID** and add it as a **member** of every project, teamspace, and chat
channel you want the agent to work in. Membership is what gates visibility and
write access — the token's role alone is not enough.

## 2. Mint the bot token

The token is a least-privilege JWT (USER role, scoped to the bot's spaces,
expiring). Minting signs with the Huly **server secret**, so run this yourself as
the operator:

```sh
HULY_SERVER_SECRET=<server-secret> node setup/huly.ts \
  --url https://huly.hz.ledoweb.com \
  --workspace <workspace-uuid> \
  --account <bot-account-uuid> \
  --spaces <projectId>,<channelId>,<teamspaceId> \
  --days 90
```

It prints the three lines to append to `.env`:

```
HULY_URL=https://huly.hz.ledoweb.com
HULY_WORKSPACE=<workspace-uuid>
HULY_TOKEN=<jwt>
```

Re-run with a fresh `--days` before expiry to rotate.

## 3. Allow egress to Huly

NanoClaw has no in-repo egress allowlist — agent-container egress is mediated by
the **OneCLI gateway**. Configure the gateway to allow the Huly host
(`huly.hz.ledoweb.com`) so the bundled MCP can reach the REST API. Without this,
`huly_*` tools time out or 403. (The host-side channel adapter runs in the
NanoClaw process, not a container, so it is not subject to the gateway.)

## 4. Restart

```sh
./nanoclaw.sh restart          # host: picks up the channel adapter
ncl groups restart <group-id>  # container: picks up the bundled MCP
```

`ncl` / the setup verifier will report `huly: configured` once the keys are set.

## What the agent gets

MCP tools (prefix `huly_`): `list_issues`, `create_issue`, `update_issue`,
`comment_issue`, `list_todos`, `create_todo`, `complete_todo`, `list_documents`,
`create_document`. Usage guidance is auto-composed into the agent's CLAUDE.md
from `huly.instructions.md`.

Chat: message the bot in a Huly channel it belongs to; @-mention it to engage in
group channels (group wirings use mention mode). Replies land back in the channel.

## Limitations & design notes

- **Poll latency** — Huly's REST API has no push, so the channel adapter polls
  (~12 s). Fine for an assistant; not instant.
- **Legacy chunter only** — built for classic chunter channels (our instance).
  Channels migrated to the newer card/communication system aren't polled; they'd
  need the `createMessage` domain-event path instead.
- **Token in container env** — the bundled MCP needs a credential, so the scoped
  token is injected into agent-container env (a deliberate exception to
  NanoClaw's minimal-env rule). The mitigation is the token itself: USER role,
  limited spaces, expiring. Future hardening: register Huly as an
  OneCLI-gateway-managed service and inject the credential at the proxy instead.
- **Rich bodies** — issue descriptions and document content are written through
  Huly's collaborator service; pass markdown to the tool `description`/`content`
  args and the MCP handles the conversion.
