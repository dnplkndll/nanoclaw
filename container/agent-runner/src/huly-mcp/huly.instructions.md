## Huly project management (mcp**huly** tools)

You can read and write issues, todos, and documents in the connected Huly
workspace. Tools are prefixed `huly_`.

**Discovery** (call these first — you can't guess ids)
- `huly_list_projects()` — project identifiers (e.g. `DURO`) and names.
- `huly_list_teamspaces()` — teamspace names for document tools.
- `huly_list_members()` — Employee refs + names, for assignees and todo users.
- `huly_whoami()` — the bot's own Employee ref and social id.

**Issues**
- `huly_list_issues(project, [limit])` — status/priority are returned as words.
- `huly_get_issue(identifier)` — one issue's detail (e.g. `DURO-42`).
- `huly_create_issue(project, title, [description], [status], [priority], [assignee])` — `description` is markdown; `status` ∈ backlog|todo|inprogress|done|cancelled; `priority` ∈ nopriority|urgent|high|medium|low; `assignee` is an Employee ref.
- `huly_update_issue(identifier, [title], [status], [priority], [assignee])`.
- `huly_comment_issue(identifier, message)` — markdown comment on the timeline.

**Todos**
- `huly_list_todos([user], [includeDone])`, `huly_create_todo(title, [user], [attachedTo], [priority])`, `huly_complete_todo(id)`. `user` is an Employee ref and defaults to the bot's own when omitted; `attachedTo` is an issue `_id`. Note the **todo** priority scale is high|medium|low|nopriority|urgent — different order from issue priority.

**Documents**
- `huly_list_documents(teamspace)`, `huly_create_document(teamspace, title, [content])`.

Notes:
- Issue/document bodies are rich text via the collaborator service — pass markdown to `description`/`content`; don't set them another way.
- The bot posts as its own Huly account; it only sees projects, teamspaces, and channels it is a member of.
- Prefer `huly_list_issues` before creating to avoid duplicates, and confirm with the user before bulk changes.
