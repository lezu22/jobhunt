const BASE = '/api'

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  // Config
  getConfig:  ()     => req('GET',  '/config'),
  saveConfig: (data) => req('POST', '/config', data),
  getUrls:    ()     => req('GET',  '/urls'),
  saveUrls:   (data) => req('POST', '/urls', data),
  getExcludes:  ()     => req('GET',  '/excludes'),
  saveExcludes: (data) => req('POST', '/excludes', data),

  // Scraper
  startScrape:     (opts = {})  => req('POST',   '/scrape', opts),
  pollScrape:      (jobId)      => req('GET',    `/scrape/status/${jobId}/poll`),
  getCheckpoint:   ()           => req('GET',    '/scrape/checkpoint'),
  clearCheckpoint: ()           => req('DELETE', '/scrape/checkpoint'),

  // Results
  getResults: () => req('GET', '/results'),
  refilterResults: () => req('POST', '/results/refilter'),
  purgeUntrackedResults: () => req('DELETE', '/results/untracked'),
  deleteResult: (jobId) => req('DELETE', `/results/${jobId}`),

  // Tracker
  getTracker:          (status) => req('GET',    `/tracker${status ? `?status=${status}` : ''}`),
  getTrackerIds:       ()       => req('GET',    '/tracker/ids'),
  addToTracker:        (job)    => req('POST',   '/tracker', job),
  updateTracker:       (id, u)  => req('PATCH',  `/tracker/${id}`, u),
  deleteFromTracker:   (id)     => req('DELETE', `/tracker/${id}`),

  // Stats
  getStats: () => req('GET', '/stats'),

  // Work Stories: categories
  getStoryCategories:    ()         => req('GET',    '/stories/categories'),
  createStoryCategory:   (name)     => req('POST',   '/stories/categories', { name }),
  renameStoryCategory:   (id, name) => req('PATCH',  `/stories/categories/${id}`, { name }),
  deleteStoryCategory:   (id)       => req('DELETE', `/stories/categories/${id}`),
  reorderStoryCategories:(ids)      => req('PUT',    '/stories/categories/order', { ids }),

  // Work Stories: stories/notes
  getStories:      (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    const s = q.toString()
    return req('GET', `/stories${s ? `?${s}` : ''}`)
  },
  getStory:        (id)          => req('GET',    `/stories/${id}`),
  createStory:     (data)        => req('POST',   '/stories', data),
  updateStory:     (id, data)    => req('PATCH',  `/stories/${id}`, data),
  revertStory:     (id)          => req('POST',   `/stories/${id}/revert`),
  deleteStory:     (id)          => req('DELETE', `/stories/${id}`),
  bulkDeleteStories:(ids)        => req('POST',   '/stories/bulk-delete', { ids }),
  bulkMoveStories: (ids, categoryId) => req('POST', '/stories/bulk-move', { ids, category_id: categoryId }),
  reorderStories:  (categoryId, ids) => req('PUT', '/stories/order', { category_id: categoryId, ids }),
  getStoryLabels:  ()            => req('GET',    '/stories/labels'),
  importParse: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/stories/import/parse`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },
  importCommit: (records) => req('POST', '/stories/import/commit', { records }),
  exportStories: (ids, includeMetadata, filename) =>
    req('POST', '/stories/export', { ids, include_metadata: includeMetadata, filename }),
}
