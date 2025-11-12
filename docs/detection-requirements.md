# Detection vs Transfer Requirements (2025-11-12)

Context from repeated bug reports:

- `检测新篇` must **never** auto-transfer. It should only crawl Chaospace, diff against the stored history record, and update the history snapshot (including any “has updates” indicators shown in the UI).
- Explicit transfer should remain a separate action (per-entry “转存新篇” and the batch transfer path). When a user decides to transfer, reuse the diffs that the latest detection just produced instead of scraping again.
- `批量检测/转存` must also respect the split: first detect every selected series, then ask/allow for explicit transfer. The follow-up transfer run should rely on the cached detection results.
- We need regression coverage to ensure `检测新篇` on `https://www.chaospace.cc/tvshows/429494.html` performs detection-only and does not enqueue transfer jobs.
- Future changes to detection should log clearly which URLs were probed and whether a transfer job was enqueued, so we can spot accidental coupling early.

This requirement supersedes any prior “detection triggers transfer” assumptions. Do not regress without product sign-off.

Regarding the detection of episode aggregation pages with TV shows, there is an optimization method for whether episodes have been updated. If the page `https://www.chaospace.cc/tvshows/429494.html` contains `<div id="episodes" class="sbox fixidtab" style="display: block;"><h2>单季列表</h2><div id="serie_contenido"><div id="seasons"><div class="se-c"><div class="se-q"><a href="https://www.chaospace.cc/seasons/428630.html"><span class="se-t">1</span><span class="title">第一季 <i>2025-10-07</i><i>更新至E07</i><div class="se_rating">N/A</div></span></a></div><div class="se-a" style="display:block"><ul class="episodios"></ul></div></div></div></div></div>`, this information can be used to determine whether it is necessary to enter the `https://www.chaospace.cc/seasons/428630.html` page to read the episodes and thus determine if an update is needed. If the updated episodes are the same as before (then there is no need to enter the seasons page).
