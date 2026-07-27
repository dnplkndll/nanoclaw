## Huly project management (mcp**huly** tools)

You can read and write issues, todos, and documents in the connected Huly
workspace. Tools are prefixed `huly_`.

**Issues**
- `huly_list_issues(project)` — `project` is a project identifier (e.g. `DURO`) or `_id`.
- `huly_create_issue(project, title, [description], [status], [priority])` — `description` is markdown; `status` ∈ backlog|todo|inprogress|done|cancelled; `priority` ∈ nopriority|urgent|high|medium|low.
- `huly_update_issue(identifier, [status], [priority])` — `identifier` like `DURO-42`.
- `huly_comment_issue(identifier, message)` — markdown comment on the issue timeline.

**Todos**
- `huly_list_todos([user], [includeDone])`, `huly_create_todo(title, user, [attachedTo], [priority])`, `huly_complete_todo(id)`. `user` is an Employee ref; `attachedTo` is an issue `_id`.

**Documents**
- `huly_list_documents(teamspace)`, `huly_create_document(teamspace, title, [content])`.

Notes:
- Issue/document bodies are rich text stored via the collaborator service — pass markdown to the `description`/`content` args; do not try to set them any other way.
- The bot posts as its own Huly account; it can only see projects, teamspaces, and channels it is a member of.
- Prefer `huly_list_issues` before creating to avoid duplicates, and confirm with the user before bulk changes.
