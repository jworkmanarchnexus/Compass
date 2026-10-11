/* ===== The life of a report run: draft -> published -> archived =====
   Pure. The database enforces the same lock with triggers (server/db/schema.sql); these functions give the
   server and the screens one place to ask "may I?" and get a plain-language reason back.

   - A run is built as a DRAFT. Only the admin sees it.
   - Publishing locks it. A published run never changes.
   - The only way to change a published run is to ARCHIVE it (a reason AND typing RERUN) and build a new draft.
   - PICs and everyone else see the last published run until a new one is published. */

const RERUN_WORD = 'RERUN';

/* one live (draft or published) run per kind and period; archived ones are history */
function canBuild(runs, kind, period) {
  const live = runs.find(r => r.kind === kind && r.period === period && r.status !== 'archived');
  if (live) return { ok: false, error: `There is already a ${live.status} run for this period (version ${live.version}).` };
  return { ok: true };
}

function nextVersion(runs, kind, period) {
  return runs.filter(r => r.kind === kind && r.period === period).reduce((m, r) => Math.max(m, r.version), 0) + 1;
}

function canPublish(run) {
  if (run.status === 'draft') return { ok: true };
  return { ok: false, error: run.status === 'published' ? 'This run is already published and locked.' : 'An archived run cannot be published.' };
}

/* a draft may be rebuilt (it has not been seen by anyone but the admin); a published or archived run never */
function canRebuild(run) {
  if (run.status === 'draft') return { ok: true };
  return { ok: false, error: 'Only a draft can be rebuilt. A published run is locked; archive it to build a new version.' };
}

function canArchive(run, { reason, confirm }) {
  if (run.status !== 'published') return { ok: false, error: run.status === 'draft' ? 'Only a published run is archived. A draft can be rebuilt instead.' : 'This run is already archived.' };
  if (typeof reason !== 'string' || !reason.trim()) return { ok: false, error: 'Give a reason. It stays on file with the archived run.' };
  if (typeof confirm !== 'string' || confirm.trim() !== RERUN_WORD) return { ok: false, error: `Type ${RERUN_WORD} to confirm.` };
  return { ok: true };
}

/* what everyone except the admin sees: the published run with the latest period (latest version if tied) */
function currentPublished(runs, kind) {
  const pub = runs.filter(r => r.kind === kind && r.status === 'published');
  pub.sort((a, b) => b.period - a.period || b.version - a.version);
  return pub[0] || null;
}

module.exports = { RERUN_WORD, canBuild, nextVersion, canPublish, canRebuild, canArchive, currentPublished };
