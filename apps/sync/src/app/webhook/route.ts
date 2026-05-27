import { algoliasearch } from 'algoliasearch'
import { NextRequest, NextResponse } from 'next/server'

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

export async function POST(request: NextRequest) {
  let body: WebflowWebhookPayload

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const algoliaAppId = process.env.ALGOLIA_APP_ID!
    const algoliaKey = process.env.ALGOLIA_ADMIN_API_KEY!
    const indexName = process.env.ALGOLIA_INDEX_NAME!

    const { triggerType, payload } = body
    const client = algoliasearch(algoliaAppId, algoliaKey)

    switch (triggerType) {
      case 'collection_item_created':
      case 'collection_item_changed':
        if (payload.isDraft || payload.isArchived) {
          await client.deleteObject({ indexName, objectID: payload.id })
        } else {
          await client.saveObject({
            indexName,
            body: { objectID: payload.id, ...payload.fieldData },
          })
        }
        break

      case 'collection_item_deleted':
      case 'collection_item_unpublished':
        await client.deleteObject({ indexName, objectID: payload.id })
        break
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
