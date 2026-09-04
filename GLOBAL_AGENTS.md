# Global collaboration instructions

## Working method

- Use American English in project-owned identifiers, documentation, and user-facing copy. Preserve third-party API spellings when integrating external systems.
- Keep responses and project documentation concise and current.
- Name files, types, functions, objects, fields, and initializers for the concepts they represent. Prefer the shortest name that remains clear at ordinary use sites without relying on implementation history. Use a longer precise name when a shorter name is ambiguous, and apply consistent naming patterns to concepts with the same role.
- Treat runtime performance and memory efficiency as user-facing quality. Prefer native platform capabilities, bounded data structures, minimal dependencies, and measured tradeoffs; do not accept avoidable resource use for implementation convenience.
- Challenge assumptions, gaps, and weak reasoning when contrary evidence or meaningful tradeoffs exist. Do not ask questions merely to prolong discovery.
- When the user asks for guided discovery, state the number of questions, ask exactly one at a time, and adjust the stated count if the investigation reveals another necessary question.
- Establish requirements and architecture sufficiently, present a concrete plan, and obtain explicit user approval before implementation.
- After approval, perform every immediately available step in the approved plan. Continue until the approved scope is complete or progress requires a specific user decision, clarification, technical unblock, or user-observed validation. Never end a turn by merely describing work that can be performed immediately.
- There is no background execution. Never describe work as pending unless blocked on a specific user action or decision.
- When an approved scope is complete, report the outcome and identify the next concrete objective from the project's authoritative plan, roadmap, review findings, or remaining acceptance criteria. Perform useful read-only assessment or planning immediately, then request approval before beginning another implementation scope.
- Remove temporary files, directories, processes, and other artifacts when their immediate use ends. Add an artifact to version control exclusions only when it is an intentional recurring part of the workflow.

## Delivery

- Work on a dedicated branch and push focused commits as implementation progresses.
- Commit after each coherent, validated step that provides a useful review boundary. Keep commits buildable and testable. A small vertical slice may remain one commit; do not split work merely to create activity. Separate structural and behavioral changes when each can stand independently, and keep generated artifacts with the contract change that requires them.
- Keep pull requests focused, buildable, and deployable. Treat roughly 350 changed lines as a reviewability guideline rather than a fixed limit; preserve coherence when an artificial split would make the work harder to understand or validate.
- Open a pull request after completing and validating its implementation scope.
- After a pull request is merged, update the local default branch, delete the merged local branch, and prune deleted remote branches.

## Documentation

- Prefer current decisions, constraints, and acceptance criteria over implementation chronology.
- Keep one authoritative home for each fact. Link to it rather than duplicating prose.
- Remove stale, superseded, redundant, or incidental documentation instead of preserving it as project history.
