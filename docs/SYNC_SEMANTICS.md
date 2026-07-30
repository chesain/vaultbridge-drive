# Synchronization semantics

The planner is a deterministic, pure three-way comparison of the last common base manifest, current
remote manifest, and fresh local snapshot. Modification time is never the general conflict winner.

| Base-relative state            | Result                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Both unchanged                 | No operation                                                                           |
| Local-only create              | Upload pending object; add at manifest commit                                          |
| Remote-only create             | Stage, hash-verify, and install locally                                                |
| Local-only modify              | Upload replacement pending object; old object becomes post-commit orphan/recovery work |
| Remote-only modify             | Stage, hash-verify, atomically replace where adapter permits                           |
| Local-only rename              | Rename/move remote object after ownership and parent validation                        |
| Remote-only rename             | Rename local object; folders update descendant logical paths                           |
| Both modified identically      | Converge without duplicate content                                                     |
| Both modified differently      | Preserve local and remote under deterministic distinct paths                           |
| Local delete, remote unchanged | Tombstone and move remote object to recovery                                           |
| Remote delete, local unchanged | Move local object to local trash/recovery                                              |
| Modify versus delete           | Preserve changed side under a new logical ID; tombstone remains authoritative          |
| Rename versus delete           | Preserve and surface conflict                                                          |
| Rename versus modify           | Preserve both and surface conflict                                                     |
| Different simultaneous renames | Deterministic conflict; folders require explicit review                                |
| Path/case collision            | Block and require explicit rename; never auto-rename                                   |
| File/folder collision          | Block and require explicit review                                                      |

## Identity and rename detection

After first sync, stable logical IDs are authoritative. For an unsynchronized local rename,
VaultBridge uses an explicit rename event when available, otherwise a unique match on type, SHA-256
hash, and byte size. Ambiguous matches become create-plus-delete with a warning.

## Tombstone dominance

A remote tombstone for a logical ID prevents a stale local snapshot from recreating that ID. Local
content is moved to recovery or assigned a new logical ID only through conflict preservation/user
resolution. Tombstones and active entries may never share a logical ID.

## Transaction and retry semantics

Operations have stable IDs and journal states. Content upload/download is verified before the
manifest changes. The manifest is committed last under a short lease after re-reading its revision.
A revision mismatch aborts and must re-plan. Retried destructive work checks membership and
postconditions. The Drive changes feed may optimize discovery but is never correctness-critical.

The same valid planner inputs produce byte-identical operation ordering and IDs.

## Automatic execution and foreground checks

Plans containing only uploads, downloads, or renames execute without a confirmation prompt.
Deletion/tombstone creation, recovery moves, conflicts, blocked operations, permanent purges, and
mass-deletion thresholds always require explicit review.

Local-change auto-sync may race with continued typing. Before uploading a file, the executor
verifies that its bytes still match the planner snapshot. A changed source supersedes that attempt:
no stale manifest is committed, the condition does not enter failure backoff or require user action,
and auto-sync waits for the configured debounce before scanning again. Hash mismatches found after
upload or while verifying a download remain hard integrity failures.

A local path occupied by a different logical object is considered safely vacated only when the plan
contains exactly one matching file move to a valid, uniquely targeted destination that is currently
empty after cross-platform case folding. Folder moves, case-only moves, occupied destinations,
multiple destinations, chains, and swaps remain blocked. This mirrors the executor ordering: file
moves complete before staged downloads are installed.

At startup and whenever Obsidian returns to the foreground, VaultBridge performs a preview-only pull
probe in the background. The probe fetches and validates the registry and remote manifest and plans
against a fresh local scan, but does not consume queued rename evidence or execute outgoing work. If
there is no incoming remote mutation, the probe stops without a popup.

If the probe finds a download, remote rename, remote recovery mutation, or conflict caused by a
newer remote revision, VaultBridge opens a non-dismissible editing guard and performs a second fresh
scan before applying anything. This closes the local-edit race between discovery and application.
Outgoing-only work is left for the normal sync paths, where mandatory deletion, recovery, conflict,
blocked-operation, purge, and mass-deletion review remains in force. Network or authentication
failure never leaves the editor trapped behind the guard, and the status indicator shows the
resulting state.
