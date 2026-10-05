# Issue tracker: GitHub

Issues and feature specs live in GitHub Issues for AllenYolk/pi-minimal-display. Use gh from this repository and check git remote -v when resolving the target.

## Operations

- Create: gh issue create --repo AllenYolk/pi-minimal-display --title "..." --body-file <file>
- Read: gh issue view <number> --repo AllenYolk/pi-minimal-display --comments
- List: gh issue list --repo AllenYolk/pi-minimal-display --state open --json number,title,labels,assignees
- Comment: gh issue comment <number> --repo AllenYolk/pi-minimal-display --body-file <file>
- Triage: gh issue edit <number> --repo AllenYolk/pi-minimal-display --add-label <label> (or --remove-label)
- Close: gh issue close <number> --repo AllenYolk/pi-minimal-display after acceptance and validation are recorded.

Use body files for multiline Markdown. Store temporary bodies under work/; do not commit logs, credentials, or private session contents.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill conventions

"Publish to the issue tracker" means create or update a GitHub issue. "Fetch the relevant ticket" means read the issue and comments.

For wayfinding work, use one map issue and one child issue per question/task, linked through GitHub sub-issues or explicit Part of #N references. Record blocking dependencies using native issue dependencies where available, otherwise Blocked by: #N. Claim before work; resolve only after posting evidence. Do not close a task merely because a draft or implementation exists.

Keep triage labels separate from GitHub open/closed state. Use the approved spec issue as the authoritative feature contract; repository docs explain architecture and contributor workflows.
