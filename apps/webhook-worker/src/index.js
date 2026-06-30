async function algoliaDelete(appId, apiKey, indexName, objectID) {
  const res = await fetch(
    `https://${appId}.algolia.net/1/indexes/${indexName}/${encodeURIComponent(objectID)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
    }
  )
  if (!res.ok) throw new Error(`Algolia delete error: ${res.status}`)
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') {
      return Response.json({ ok: true })
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    try {
      const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME } = env
      const { triggerType, payload } = body
      console.log('[webhook] triggerType:', triggerType, 'collectionId:', payload?._cid || payload?.collectionId)

      // Full re-sync on site publish AND on any create/change event
      // (Per-item upserts would skip reference/option resolution, so we
      //  always go through the sync endpoint which has that logic.)
      if (
        triggerType === 'site_publish' ||
        triggerType === 'collection_item_created' ||
        triggerType === 'collection_item_changed'
      ) {
        const authHeader = { Authorization: `Bearer ${env.SYNC_SECRET}` }
        // Use ctx.waitUntil so the runtime keeps the worker alive until the sync
        // requests finish. A bare un-awaited fetch() would be cancelled the moment
        // we return the response, so the sync would never actually run.
        ctx.waitUntil(fetch(env.SYNC_ENDPOINT, { method: 'POST', headers: authHeader }))
        if (env.SEARCH_ALL_ENDPOINT) {
          ctx.waitUntil(fetch(env.SEARCH_ALL_ENDPOINT, { method: 'POST', headers: authHeader }))
        }
        return Response.json({ success: true, action: 'full_sync_triggered' })
      }

      // Ignore items from other collections
      const itemCollectionId = payload._cid || payload.collectionId
      if (env.WEBFLOW_COLLECTION_ID && itemCollectionId && itemCollectionId !== env.WEBFLOW_COLLECTION_ID) {
        return Response.json({ success: true, action: 'ignored' })
      }

      // Delete/unpublish — handled instantly per item (no resolution needed)
      if (
        triggerType === 'collection_item_deleted' ||
        triggerType === 'collection_item_unpublished'
      ) {
        await algoliaDelete(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id)
      }

      return Response.json({ success: true })
    } catch (err) {
      return Response.json({ error: err.message || 'Unknown error' }, { status: 500 })
    }
  },
}
