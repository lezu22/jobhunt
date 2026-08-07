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

  // Scraper
  startScrape:     (opts = {})  => req('POST',   '/scrape', opts),
  pollScrape:      (jobId)      => req('GET',    `/scrape/status/${jobId}/poll`),
  getCheckpoint:   ()           => req('GET',    '/scrape/checkpoint'),
  clearCheckpoint: ()           => req('DELETE', '/scrape/checkpoint'),

  // Results
  getResults: () => req('GET', '/results'),
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
}
