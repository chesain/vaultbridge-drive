# Deletion and recovery

Deletion is recoverable by default.

1. A local delete produces a tombstone in the next manifest revision.
2. The remote object moves into `.vaultbridge-recovery`; deleting a folder moves only its top-level
   recovered folder while descendant IDs remain tombstoned.
3. Other devices observe the tombstone and move stale local copies to
   `.trash/VaultBridge Recovery/`.
4. Retention defaults to 30 days.
5. Automatic permanent purge is disabled. Eligibility requires the retention date and, when device
   acknowledgements are available, the deletion revision acknowledgement.

Tombstones record logical ID, previous path, Drive ID when available, deletion time/device/revision,
and purge-after time. A stale device cannot interpret a tombstoned logical object as a new creation.

## Mass-deletion guard

VaultBridge blocks a plan deleting more than the lower of:

- 20 tracked objects, or
- 10% of tracked objects (rounded up, minimum one).

The preview checkbox is never preselected. Mass purge also requires explicit confirmation.

## Restoration

The core can convert a retained tombstone back into an active manifest entry at its previous or a
user-selected safe path. The 0.9 Recovery Center lists retained records and eligibility; one-click
remote move/commit UI is a remaining release enhancement. Until it lands, do not manually delete the
app-data manifest. Preserve the recovery folder and use a validated maintenance build for restore.

Permanent deletion is permitted only when the current tombstone matches the logical and Drive IDs,
the object has the correct vault properties/parent, and retention has elapsed.
