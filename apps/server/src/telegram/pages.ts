// A row of page buttons under a long list, as Telegram bots usually do it: the current page in dots,
// at most five buttons — first, three around the current one, last
export function pageRow(page: number, pages: number): { label: string, page: number }[] {
  if (pages <= 1) return []
  const label = (p: number) => (p === page ? `· ${p + 1} ·` : `${p + 1}`)
  if (pages <= 5) return Array.from({ length: pages }, (_, p) => ({ label: label(p), page: p }))
  const mid = Math.min(Math.max(page, 2), pages - 3)
  return [
    { label: page === 0 ? label(0) : '« 1', page: 0 },
    ...[mid - 1, mid, mid + 1].map(p => ({ label: label(p), page: p })),
    { label: page === pages - 1 ? label(pages - 1) : `${pages} »`, page: pages - 1 },
  ]
}
