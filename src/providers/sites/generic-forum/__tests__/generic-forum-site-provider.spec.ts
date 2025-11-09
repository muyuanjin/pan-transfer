import { describe, expect, it } from 'vitest'
import type { TransferContext } from '@/platform/registry'
import {
  GENERIC_FORUM_SITE_PROVIDER_ID,
  createGenericForumSiteProvider,
} from '../generic-forum-site-provider'

const provider = createGenericForumSiteProvider()

describe('generic forum site provider', () => {
  it('detects supported hosts', async () => {
    const matched = await provider.detect({
      url: 'https://forum.example/threads/123',
    } as TransferContext)
    expect(matched).toBe(true)
  })

  it('detects by DOM marker when host is unknown', async () => {
    const document = createDocument(`
      <html>
        <body data-pan-provider="generic-forum"></body>
      </html>
    `)
    const matched = await provider.detect({
      url: 'https://not-supported.test/topic/1',
      document,
    } as TransferContext)
    expect(matched).toBe(true)
  })

  it('collects resources and metadata via data attributes', async () => {
    const document = createDocument(`
      <html>
        <head>
          <title>Fallback Thread Title</title>
          <meta name="x-pan-transfer:thread" content='{
            "title": "Demo Thread",
            "origin": "https://forum.example",
            "tags": ["demo","指南"],
            "poster": {"src": "https://cdn.example/poster.jpg"},
            "classification": "forum-thread"
          }' />
        </head>
        <body data-pan-provider="generic-forum">
          <ul>
            <li
              data-pan-resource
              data-pan-resource-id="episode-1"
              data-pan-resource-title="Episode 1"
              data-pan-resource-link="https://cdn.example/episode-1.zip"
              data-pan-resource-passcode="a1b2"
              data-pan-resource-tags="1080p,cn"
              data-pan-resource-season-label="Season 1"
              data-pan-resource-season-index="0"
            ></li>
            <li data-pan-resource data-pan-resource-json='{
              "title": "Episode 2",
              "linkUrl": "https://cdn.example/episode-2.zip",
              "sectionLabel": "Bonus"
            }'></li>
          </ul>
        </body>
      </html>
    `)
    const collection = await provider.collectResources({
      url: 'https://forum.example/threads/777',
      document,
    } as TransferContext)

    expect(collection.items).toHaveLength(2)
    expect(collection.items[0]).toMatchObject({
      id: 'episode-1',
      title: 'Episode 1',
      linkUrl: 'https://cdn.example/episode-1.zip',
      passCode: 'a1b2',
      tags: ['1080p', 'cn'],
      meta: {
        seasonLabel: 'Season 1',
        seasonIndex: 0,
      },
    })
    expect(collection.items[1]).toMatchObject({
      title: 'Episode 2',
      linkUrl: 'https://cdn.example/episode-2.zip',
      meta: {
        sectionLabel: 'Bonus',
      },
    })
    expect(collection.meta).toMatchObject({
      pageTitle: 'Demo Thread',
      pageUrl: 'https://forum.example/threads/777',
      origin: 'https://forum.example',
      siteProviderId: GENERIC_FORUM_SITE_PROVIDER_ID,
      siteProviderLabel: 'Generic Forum',
    })
    expect(collection.issues).toBeUndefined()
  })
})

function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}
