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

At startup and whenever Obsidian returns to the foreground, VaultBridge temporarily blocks in-app
editing, fetches and validates the registry and remote manifest, plans against a fresh local scan,
and applies safe remote changes before releasing the editor. The blocker is released on network or
authentication failure so an offline device remains usable. The status indicator continues to show
the resulting offline, action-required, conflict, or error state.
