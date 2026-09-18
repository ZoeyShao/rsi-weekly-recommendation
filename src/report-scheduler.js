export async function ensureReportsForDigest({ digest, store, runner }) {
  if (digest.kind !== "digest" || digest.status !== "succeeded" || !Array.isArray(digest.result?.papers)) return [];
  const created = [];
  for (const paper of digest.result.papers) {
    const exists = store.list().some((candidate) =>
      (candidate.kind ?? "report") === "report"
      && candidate.parentJobId === digest.id
      && candidate.arxivId === paper.arxiv_id
    );
    if (!exists) {
      created.push(await runner.enqueue({
        kind: "report",
        parentJobId: digest.id,
        arxivId: paper.arxiv_id,
        referenceTime: digest.referenceTime,
      }));
    }
  }
  return created;
}
