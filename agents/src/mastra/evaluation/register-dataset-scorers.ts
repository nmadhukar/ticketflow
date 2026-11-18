/**
 * Pins the deterministic scorers on the evaluation dataset, so an experiment started from Studio's
 * Experiments page produces SCORES instead of empty rows.
 *
 * Why it was empty: an experiment only scores an item when a scorer is resolved for it. Mastra's
 * precedence is experiment `scorers` → item `scorerIds` → DATASET `scorerIds` → none. Studio's
 * "run experiment" sends no experiment-level scorers, so a dataset with none attached runs every
 * case and records no score at all. The Scorers page was fine because it reads the instance
 * registry (index.ts), which is not what the experiment run consults.
 *
 * Setting the dataset's `scorerIds` (the documented field, server-handlers create/update both
 * accept it) fixes every experiment and every item at once, and Studio's Runs page shows them.
 *
 * Best effort: a missing dataset is not an error (the first eval run creates it, and this runs
 * again at the next start), and a failure is logged by name only.
 */

export const EVAL_DATASET_NAME = 'ticketflow-assistant-evals';

/** The scorer ids index.ts registers, in the order an experiment should show them. */
export const EVAL_SCORER_IDS = ['helpdesk-rules', 'grounded-in-tools', 'resolution-quality'];

type DatasetRecordLike = { id?: string; name?: string; scorerIds?: string[] | null };
type DatasetLike = {
  getDetails?: () => Promise<DatasetRecordLike>;
  update?: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Pin the scorers on the evaluation dataset when it exists. Returns the dataset id, or null when
 * there is no dataset yet.
 */
export async function attachDatasetScorers(datasets: {
  list: () => Promise<{ datasets: Array<{ id: string; name: string }> }>;
  get: (args: { id: string }) => Promise<DatasetLike>;
}): Promise<string | null> {
  const listed = await datasets.list();
  const found = listed.datasets.find((dataset) => dataset.name === EVAL_DATASET_NAME);
  if (!found) return null;

  const dataset = await datasets.get({ id: found.id });
  if (typeof dataset.update !== 'function') return found.id;

  const details = typeof dataset.getDetails === 'function' ? await dataset.getDetails() : {};
  const current = Array.isArray(details.scorerIds) ? details.scorerIds : [];
  const missing = EVAL_SCORER_IDS.filter((id) => !current.includes(id));
  if (missing.length === 0) return found.id;

  // The full list replaces the old one: an id already attached is kept in place, and the new ones
  // are appended so the order matches the registry.
  await dataset.update({ scorerIds: [...current, ...missing] });
  console.log(`[ticketflow-agents] dataset scorers pinned: ${[...current, ...missing].join(', ')}`);
  return found.id;
}
