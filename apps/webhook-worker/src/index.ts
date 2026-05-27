interface Env {
  ALGOLIA_APP_ID: string
  ALGOLIA_ADMIN_API_KEY: string
  ALGOLIA_INDEX_NAME: string
}

interface WebflowWebhookPayload {
  triggerType:
    | 'collection_item_created'
    | 'collection_item_changed'
    | 'collection_item_deleted'
    | 'collection_item_unpublished'
  payload: {
    id: string
    fieldData: Record<string, unknown>
    isDraft: boolean
    isArchived: boolean
  }
}

async function algoliaUpsert(
  appId: string,
  apiKey: string,
  indexName: string,
  objectID: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `https://${appId}.algolia.net/1/indexes/${indexName}/${encodeURIComponent(objectID)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
      body: JSON.stringify({ objectID, ...fields }),
    }
  )
  if (!res.ok) throw new Error(`Algolia upsert error: ${res.status}`)
}

async function algoliaDelete(
  appId: string,
  apiKey: string,
  indexName: string,
  objectID: string
): Promise<void> {
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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET') {
      return Response.json({ ok: true })
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    let body: WebflowWebhookPayload
    try {
      body = await request.json() as WebflowWebhookPayload
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    try {
      const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME } = env
      const { triggerType, payload } = body

      switch (triggerType) {
        case 'collection_item_created':
        case 'collection_item_changed':
          if (payload.isDraft || payload.isArchived) {
            await algoliaDelete(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id)
          } else {
            await algoliaUpsert(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id, payload.fieldData)
          }
          break

        case 'collection_item_deleted':
        case 'collection_item_unpublished':
          await algoliaDelete(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id)
          break
      }

      return Response.json({ success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  },
}
