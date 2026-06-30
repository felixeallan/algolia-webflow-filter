# Algolia × Webflow Library

A drop-in Algolia integration for Webflow, driven entirely by HTML `data-*` attributes. It powers **two independent features** — use one, or both:

- **Filtering** — render a single CMS collection past Webflow's 100-item cap, with full-text search, faceted filtering, range sliders, sorting, pagination, and URL state sync.
- **Federated search** — a single site-wide search index that aggregates **multiple CMS collections plus static pages** into one normalized result set, with autosuggest and a dedicated results page.

Both share the same three-part architecture and the same client library — they differ only in which sync endpoint, which Algolia index, and which HTML you use. The setup below is split accordingly: a **shared foundation**, then **Feature A (Filtering)** and **Feature B (Federated search)** as separate tracks.

## How it works

```
Webflow CMS
    ↓  full sync (Next.js on Webflow Cloud)
Algolia Index
    ↓  search-only API (client library)
Webflow page (rendered with filters or search)
```

Three parts:
1. **Sync app** (`apps/sync`) — Next.js on Webflow Cloud. Exposes two endpoints:
   - `POST /api/sync` — full sync of **one** CMS collection into a filter index (resolves references and option fields to human-readable values). Powers **Feature A**.
   - `POST /api/search-all` — aggregates **many** collections + static pages into one normalized federated index. Powers **Feature B**.
2. **Webhook worker** (`apps/webhook-worker`) — A Cloudflare Worker that listens for Webflow webhooks, keeps the filter index in sync incrementally (per-item changes), and triggers a full re-sync of both endpoints on site publish.
3. **Client library** (`packages/library`) — A vanilla JS bundle loaded via a single `<script>` tag in Webflow. Reads HTML attributes, queries Algolia, renders results, handles filters/search/pagination/tags.

---

## Prerequisites

- A Webflow site with one or more CMS collections you want to filter or search
- A free [Algolia](https://www.algolia.com) account
- A free [Cloudflare](https://dash.cloudflare.com) account (for the webhook worker)
- A [GitHub](https://github.com) account

---

# Setup — Part 1: Shared foundation

Every project does these six steps once, regardless of whether you use filtering, federated search, or both. The feature-specific steps come afterward in **Feature A** and **Feature B**.

## Step 1 — Create your project from the template

1. Go to [github.com/felixeallan/algolia-webflow-filter](https://github.com/felixeallan/algolia-webflow-filter)
2. Click **"Use this template"** → **"Create a new repository"**
3. Name it (e.g. `my-site-algolia`) and make it **public** (required so jsDelivr can serve the script)
4. Done — you have your own copy.

## Step 2 — Create an Algolia application

1. Sign up at [algolia.com](https://www.algolia.com) and create an application
2. Go to **Settings → API Keys** and copy these three values:
   - **Application ID** → `ALGOLIA_APP_ID`
   - **Search API Key** → used later in the script tag (safe to expose in the browser)
   - **Write API Key** → `ALGOLIA_ADMIN_API_KEY` (keep secret, only used server-side)

> You'll create the actual **index(es)** in the feature tracks below — Algolia creates an index automatically the first time you sync to it, so there's nothing to create manually here.

## Step 3 — Get the Webflow API token

1. Webflow → **Site Settings → Apps & Integrations → API Access → Generate API Token**
2. Permissions: **CMS: Read** (read-only is enough — the sync never writes back)
3. Copy the token → `WEBFLOW_API_TOKEN`

> Collection IDs are configured per feature — a single ID for Feature A, a list for Feature B.

## Step 4 — Deploy the sync app to Webflow Cloud

1. In your Webflow site → **Site Settings → Webflow Cloud**
2. Click **"Install GitHub app"** if needed, then **"New app"**
3. Configure:
   - **Name**: anything (e.g. `algolia-sync`)
   - **Repository**: your project repo from Step 1
   - **Directory path**: `apps/sync`
   - **GitHub branch**: `main`
   - **Path**: `/api` (this becomes the URL prefix, e.g. `yoursite.com/api/sync`)
4. Once the environment is created, go to **Environment Variables** and add these **base** variables (each feature adds a few more later):
   ```
   WEBFLOW_API_TOKEN        (Secret)
   ALGOLIA_APP_ID           (Text)
   ALGOLIA_ADMIN_API_KEY    (Secret — this is the Write API Key)
   SYNC_SECRET              (Secret — generate with: openssl rand -hex 32)
   ```
5. Click **"Deploy latest commit"**. Wait for the deployment to go live.

> You'll come back to **Environment Variables** to add `WEBFLOW_COLLECTION_ID` + `ALGOLIA_INDEX_NAME` (Feature A) and/or `ALGOLIA_SEARCH_ALL_INDEX` + `SITE_URL` (Feature B), then redeploy.

## Step 5 — Deploy the webhook worker (Cloudflare)

The sync app handles bulk syncs; the webhook worker keeps Algolia current as editors publish/change/delete individual items. Webflow refuses to send webhooks to `*.webflow.io` domains, so this external worker is required.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker** → **Hello World**
2. Name it (e.g. `algolia-webflow-webhook`) → **Deploy**
3. Click **"Edit code"**, delete everything, and paste the contents of [apps/webhook-worker/src/index.js](apps/webhook-worker/src/index.js) → **Deploy**
4. Go to **Settings → Variables and Secrets** and add these **base** variables:
   ```
   ALGOLIA_APP_ID            (Text)
   ALGOLIA_ADMIN_API_KEY     (Secret — the Write API Key)
   SYNC_ENDPOINT             (Text — https://YOUR_SITE.webflow.io/api/sync)
   SYNC_SECRET               (Secret — same as Webflow Cloud)
   ```
   Feature A adds `ALGOLIA_INDEX_NAME` + `WEBFLOW_COLLECTION_ID` (for per-item deletes); Feature B adds `SEARCH_ALL_ENDPOINT`.
5. Note your worker URL — looks like `https://algolia-webflow-webhook.YOUR-USERNAME.workers.dev`

Then register the webhooks. Webflow → **Site Settings → Apps & Integrations → Webhooks → Add Webhook** for each event below, all pointing at the worker URL:

| Event | Purpose |
|---|---|
| `collection_item_created` | New items trigger a re-sync |
| `collection_item_changed` | Edits trigger a re-sync |
| `collection_item_deleted` | Deletes remove the item from the filter index |
| `collection_item_unpublished` | Unpublished items removed from the filter index |
| `site_publish` | Triggers a full re-sync of every configured endpoint |

You do not need a webhook secret. Leave that field blank.

## Step 6 — Add the library to your Webflow page

In Webflow → **Site Settings → Custom Code → Footer**:

```html
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.8.13/packages/library/dist/algolia-webflow.min.js"></script>
```

**Always pin to a version tag** (e.g. `@v0.8.13`). Do not use `@main` — jsDelivr aggressively caches branch URLs.

The same script tag powers both features — you don't add it twice.

---

# Feature A — Filter a collection

Render one CMS collection past Webflow's 100-item cap, with faceted filters, ranges, sorting, and pagination. Complete the **shared foundation** above first.

## A.1 — Configure the filter index

1. In Webflow → CMS → click the collection you want to filter → **Settings** → copy the **Collection ID**.
2. Decide an index name (e.g. `products`, `blog-posts`, `cars`).
3. In your Webflow Cloud app → **Environment Variables**, add:
   ```
   WEBFLOW_COLLECTION_ID    (Text — the collection you're filtering)
   ALGOLIA_INDEX_NAME       (Text — the index name you chose)
   ```
4. In your **Cloudflare Worker** → **Settings → Variables**, add the same two (so per-item deletes hit the right index and webhooks from other collections are ignored):
   ```
   ALGOLIA_INDEX_NAME       (Text)
   WEBFLOW_COLLECTION_ID    (Text)
   ```
5. **Deploy latest commit** in Webflow Cloud and re-deploy the worker.

Health check should return `{"ok":true}`:
```bash
curl https://YOUR_SITE.webflow.io/api/sync
```

## A.2 — Run the initial sync

```bash
curl -X POST https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Expected response:
```json
{ "success": true, "synced": 1234 }
```

Check Algolia → your index → **Browse** — all your CMS items should be there.

## A.3 — Configure Algolia (Facets + Searchable Attributes)

In Algolia → your index → **Configuration**:

**Facets** — fields you want to filter by:
- Add every attribute that will be used as a filter (e.g. `category`, `brand`, `color`, `year`)
- Reference fields show up as the referenced item's name automatically (e.g. `car-brand: "Quasar"`)

**Searchable Attributes** — fields used by the search input:
- Set to **Ordered** mode
- Top of the list = higher relevance
- Add fields like `name`, `title`, `description`

Click **"Review and Save settings"**.

## A.4 — (Optional) Configure sorting

Sorting in Algolia works through **replica indexes** — pre-sorted copies of the main index. Each user-facing sort option = one replica. Algolia keeps replicas in sync automatically.

### A.4.1 — Create one replica per sort option

In Algolia → your main index → **Configuration → Replicas → Create Replica**:

1. Choose **Virtual replica** (free, no extra storage)
2. Name it descriptively, matching the format `INDEX_FIELD_DIRECTION`:

| Sort option | Replica name |
|---|---|
| Name A → Z | `cars_name_asc` |
| Name Z → A | `cars_name_desc` |
| Price ↑ | `cars_price_asc` |
| Price ↓ | `cars_price_desc` |
| Year newest | `cars_year_desc` |
| Year oldest | `cars_year_asc` |

3. Click **Create**. Repeat for each sort option you want.

### A.4.2 — Configure each replica's Sort-by rule

A replica is empty until you tell it how to sort. For **each** replica:

1. Click the replica name (e.g. `cars_name_asc`) to open it
2. Go to **Configuration → Relevant sort** (or "Ranking and Sorting")
3. Add **exactly one** Sort-by rule that matches the replica's name:
   - `cars_name_asc` → Sort-by `name` Ascending
   - `cars_name_desc` → Sort-by `name` Descending
   - `cars_price_asc` → Sort-by `price` Ascending
   - …etc.
4. Click **Review and Save settings**

> **Important:** Each replica must have **exactly one** Sort-by rule. Multiple rules turn additional ones into tiebreakers, which is rarely what you want for user-facing sorting. One replica = one dropdown option.

### A.4.3 — Add the sort dropdown to your page

Use a native `<select>` element. In **Webflow Designer → Add panel → Forms → Select**, drag a Select field onto the page (not the navigation "Dropdown" component — that's a div-based menu and won't fire `change` events).

Then add `data-algolia-sort` and option values matching your replica names exactly:

```html
<select data-algolia-sort>
  <option value="">Default (relevance)</option>
  <option value="cars_name_asc">Name: A → Z</option>
  <option value="cars_name_desc">Name: Z → A</option>
  <option value="cars_price_asc">Price: Low → High</option>
  <option value="cars_price_desc">Price: High → Low</option>
  <option value="cars_year_desc">Year: Newest first</option>
  <option value="cars_year_asc">Year: Oldest first</option>
</select>
```

The empty option (`value=""`) keeps the default relevance ranking.

### A.4.4 — Caveat: sorting numbers stored as strings

For sorting to behave numerically, the field must be a **number** in Algolia. If a field is stored as a string with commas (e.g. `"14,020"`), Algolia sorts it alphabetically — `"9,999"` would come after `"14,020"`. Use a Webflow **Number** field (not a Plain text field formatted to look like a number) for any field you plan to sort numerically.

## A.5 — Build the filter UI

Drop this structure onto your Webflow page. Every attribute is documented in the **Data attribute reference** further below.

```html
<div
  data-algolia
  data-algolia-app-id="YOUR_APP_ID"
  data-algolia-api-key="YOUR_SEARCH_ONLY_KEY"
  data-algolia-index="cars"
  data-algolia-hits-per-page="12"
  data-algolia-url-state
>

  <!-- Search input -->
  <input data-algolia-search type="text" placeholder="Search...">

  <!-- Filters: checkbox = multi-select (OR within group, AND between groups) -->
  <label data-algolia-filter="car-brand" data-algolia-value="Quasar">
    <input type="checkbox"><span>Quasar</span>
  </label>

  <!-- Filters: radio = single-select within the group -->
  <label data-algolia-filter="color-theme" data-algolia-value="White">
    <input type="radio" name="color"><span>White</span>
  </label>

  <!-- Dropdown filter -->
  <select data-algolia-filter-select="year">
    <option value="">All years</option>
    <option value="2024">2024</option>
    <option value="2023">2023</option>
  </select>

  <!-- Sort dropdown (uses Algolia index replicas) -->
  <select data-algolia-sort>
    <option value="">Relevance</option>
    <option value="cars_price_asc">Price ↑</option>
    <option value="cars_price_desc">Price ↓</option>
  </select>

  <!-- Clear buttons -->
  <button data-algolia-clear>Clear all</button>
  <button data-algolia-clear="car-brand">Clear brands</button>

  <!-- Active filter tags -->
  <div data-algolia-tags>
    <div data-algolia-tag-template class="tag">
      <span data-algolia-tag-label></span>
      <span data-algolia-tag-remove>×</span>
    </div>
  </div>

  <!-- Result list with template -->
  <div data-algolia-list>
    <div data-algolia-template class="card">
      <img data-algolia-bind="image.url" data-algolia-attr="src">
      <h3 data-algolia-bind="name"></h3>
      <p data-algolia-bind="car-brand"></p>
      <img data-algolia-bind="car-brand__logo.url" data-algolia-attr="src">
      <p data-algolia-bind="price"></p>
      <p data-algolia-bind="year"></p>

      <!-- Repeat for array/multi-reference fields -->
      <div data-algolia-hide-empty="authors" data-algolia-repeat="authors">
        <span data-algolia-repeat-item class="author-tag"></span>
      </div>

      <a data-algolia-bind="slug" data-algolia-attr="href">View</a>
    </div>
  </div>

  <!-- Stats -->
  <p><span data-algolia-count></span> results</p>

  <!-- Empty state -->
  <div data-algolia-empty style="display:none">No results found.</div>

  <!-- Pagination -->
  <button data-algolia-prev>← Previous</button>
  <span data-algolia-page-info></span>
  <button data-algolia-next>Next →</button>

</div>
```

---

# Feature B — Federated search across collections

A single site-wide search that returns results from **multiple CMS collections plus static pages** in one ranked list — think the search box in a site's navbar that can surface a product, a blog post, an author, and an "About" page side by side. Complete the **shared foundation** above first. This feature is fully independent of Feature A: you can run it on its own, or alongside filtering.

## B.1 — How it works

Federated search uses a **second Algolia index** (commonly named `search_all`) populated by the `POST /api/search-all` endpoint. That endpoint reads every source you configure and normalizes each record — no matter which collection it came from — into the same fixed seven-field shape:

| Field | What it holds |
|---|---|
| `objectID` | Unique ID, prefixed per source (`car__<id>`, `author__<id>`, `page__about`) so IDs never collide across collections |
| `title` | The result's headline |
| `description` | Supporting text (optional per source) |
| `url` | Absolute link to the page, built from `SITE_URL` + the item's slug |
| `image` | Image URL **as a plain string** (already extracted — see the binding note in B.7) |
| `type` | The source label (`"Car"`, `"Author"`, `"Page"`, …) — used for the type filter |
| `date` | ISO date string (from the item's last-updated time); empty for static pages |

Because every record has the same shape, **your search UI never changes** when you add or remove a collection — it always binds to `title`, `description`, `image`, `url`, `type`, `date`. The only thing that varies per project is the **config file** that maps each of your collections into these fields.

## B.2 — Configure your sources

Open [apps/sync/src/search-all-config.ts](apps/sync/src/search-all-config.ts). This is the **only file you edit** — the sync route itself is generic. It has two arrays:

**`collections`** — one entry per CMS collection you want searchable:

```ts
export const collections: CollectionConfig[] = [
  {
    collectionId: 'YOUR_COLLECTION_ID',   // Webflow → CMS → collection → Settings
    type: 'Product',                      // stored as "type"; drives the type filter
    prefix: 'product',                    // objectID prefix → product__<item-id>
    urlPattern: '/products/{slug}',       // {slug} is replaced with the item's slug
    titleField: 'name',                   // Webflow field slug for the title
    descriptionField: 'summary',          // optional — omit if the collection has none
    imageField: 'main-image',             // optional — omit if the collection has none
  },
  // …add another object per collection
]
```

| Key | Required | Purpose |
|---|---|---|
| `collectionId` | ✅ | The Webflow collection to pull from |
| `type` | ✅ | Label stored in the `type` field (used by the type filter on the results page) |
| `prefix` | ✅ | Keeps `objectID`s unique across collections |
| `urlPattern` | ✅ | Relative path with `{slug}` placeholder; prefixed with `SITE_URL` at sync time |
| `titleField` | ✅ | Field slug that becomes `title` |
| `descriptionField` | optional | Field slug that becomes `description` (omit → empty) |
| `imageField` | optional | Field slug that becomes `image` (omit → empty) |

**`staticPages`** — pages that aren't CMS items (home, about, pricing…):

```ts
export const staticPages: StaticPage[] = [
  { objectID: 'page__about',   title: 'About',   description: 'Learn about us',  urlPath: '/about'   },
  { objectID: 'page__pricing', title: 'Pricing', description: 'Our plans',       urlPath: '/pricing' },
]
```

> Field **slugs** are the lowercase-hyphenated API names, not the Designer display names (e.g. "Bio Summary" → `bio-summary`). If you're unsure of a slug, see [Inspecting the Webflow collection schema](#inspecting-the-webflow-collection-schema).

## B.3 — Add the search env vars

In your Webflow Cloud app → **Environment Variables**, add:

```
ALGOLIA_SEARCH_ALL_INDEX   (Text — the federated index name, e.g. "search_all")
SITE_URL                   (Text — your site's base URL, no trailing slash, e.g. https://YOUR_SITE.webflow.io)
```

Then **Deploy latest commit**. (`WEBFLOW_API_TOKEN`, `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_API_KEY`, and `SYNC_SECRET` are already set from the foundation.)

## B.4 — Run the initial search sync

```bash
curl -X POST https://YOUR_SITE.webflow.io/api/search-all \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

The response breaks down what was indexed per `type`:
```json
{ "success": true, "synced": 1812, "breakdown": { "Product": 1786, "Author": 23, "Page": 3 } }
```

Check Algolia → your `search_all` index → **Browse** to confirm the normalized records.

## B.5 — Configure Algolia for the search index

In Algolia → your `search_all` index → **Configuration**:

- **Searchable Attributes** (Ordered): add `title` then `description`.
- **Facets → Attributes for faceting**: add `type` (required for the content-type filter on the results page).
- **(Optional) Sorting by date** — create replicas exactly as in [A.4](#a4--optional-configure-sorting), one Sort-by rule each:

  | Sort option | Replica name | Sort-by rule |
  |---|---|---|
  | Newest first | `search_all_date_desc` | `date` Descending |
  | Oldest first | `search_all_date_asc` | `date` Ascending |

Click **Review and Save settings**.

## B.6 — Keep the search index live on edits

Add one variable to your **Cloudflare Worker** → **Settings → Variables**:

```
SEARCH_ALL_ENDPOINT   (Text — https://YOUR_SITE.webflow.io/api/search-all)
```

Re-deploy the worker. Now whenever an item is created/changed or the site is published, the worker triggers a full re-sync of **both** the filter index and the search index.

> **Why a full re-sync (and why it doesn't time out):** federated records are normalized from many collections, so the worker re-runs the whole `/api/search-all` build rather than patching one record. It fires that request with `ctx.waitUntil()`, which keeps the Worker alive until the (multi-second) sync finishes — a bare un-awaited `fetch()` would be cancelled the instant the Worker returns its response. This is already handled in the worker code; just make sure `SEARCH_ALL_ENDPOINT` points at the **same domain** as your live sync app.

## B.7 — Build the search UI

A federated search experience is usually two pieces: a **standalone search box** in the navbar (with optional autosuggest) and a dedicated **results page**.

```html
<!-- 1. Navbar search box (lives outside any [data-algolia] wrapper) -->
<div style="position:relative">
  <input
    type="text"
    placeholder="Search…"
    data-algolia-search-box
    data-algolia-app-id="YOUR_APP_ID"
    data-algolia-api-key="YOUR_SEARCH_KEY"
    data-algolia-index="search_all"
    data-algolia-search-action="both"
    data-algolia-search-target="/search"
  />

  <!-- Optional autosuggest dropdown -->
  <div data-algolia-autosuggest>
    <div data-algolia-autosuggest-template>
      <a data-algolia-autosuggest-link>
        <span data-algolia-bind="title"></span>
        <span data-algolia-bind="type"></span>
      </a>
    </div>
  </div>
</div>
```

```html
<!-- 2. Results page (e.g. at /search) — reads ?q= from the URL automatically -->
<div
  data-algolia
  data-algolia-app-id="YOUR_APP_ID"
  data-algolia-api-key="YOUR_SEARCH_KEY"
  data-algolia-index="search_all"
  data-algolia-search-mode="empty"
  data-algolia-url-state
>
  <input type="text" data-algolia-search placeholder="Search…" />

  <!-- Show the current query, e.g. "Results for 'tesla'" -->
  <p>Results for "<span data-algolia-query></span>" — <span data-algolia-count></span> found</p>

  <!-- Filter by content type (values must match the `type` labels in your config) -->
  <label data-algolia-filter-all="type"><input type="radio" name="type"> All</label>
  <label data-algolia-filter="type" data-algolia-value="Product"><input type="radio" name="type"> Products</label>
  <label data-algolia-filter="type" data-algolia-value="Author"><input type="radio" name="type"> Authors</label>
  <label data-algolia-filter="type" data-algolia-value="Page"><input type="radio" name="type"> Pages</label>

  <!-- Optional sort (needs the replicas from B.5) -->
  <select data-algolia-sort>
    <option value="search_all">Relevance</option>
    <option value="search_all_date_desc">Newest</option>
  </select>

  <div data-algolia-list>
    <div data-algolia-template>
      <a data-algolia-bind="url" data-algolia-attr="href">
        <!-- image is a plain URL string here — bind "image", NOT "image.url" -->
        <img data-algolia-bind="image" data-algolia-attr="src" data-algolia-hide-empty="image">
        <p data-algolia-bind="title"></p>
        <p data-algolia-bind="description"></p>
        <span data-algolia-bind="type"></span>
        <span data-algolia-bind="date" data-algolia-bind-format="date"></span>
      </a>
    </div>
  </div>

  <div data-algolia-empty style="display:none">No results found.</div>
</div>
```

Three things specific to federated search:

- **Bind `image`, not `image.url`.** The `/api/search-all` route extracts the image URL into a plain string during sync, so the field is already a URL. (Feature A's filter index keeps Webflow's nested image object, where you bind `image.url`.) Add `data-algolia-hide-empty="image"` so sources without an image — like static pages — don't render a broken `<img>`.
- **`data-algolia-search-mode="empty"`** keeps the results page blank until the visitor types, instead of dumping every record on load.
- **Type filter values must match your config's `type` labels exactly** (`"Product"`, `"Author"`, `"Page"`…). These are facet filters, which is why `type` had to be added as a facet in B.5.

See the **Global search box** and **Autosuggest** entries in the reference below for every standalone-input and dropdown option.

---

# Data attribute reference

## Wrapper (required)

| Attribute | Element | Description |
|---|---|---|
| `data-algolia` | any (wrapper div) | Marks the root. Everything else must be inside. |
| `data-algolia-app-id="..."` | wrapper | Algolia Application ID |
| `data-algolia-api-key="..."` | wrapper | Algolia **Search-Only** API key (safe to expose) |
| `data-algolia-index="..."` | wrapper | Algolia index name |
| `data-algolia-hits-per-page="12"` | wrapper | Number of results per page (default 12) |
| `data-algolia-url-state` | wrapper | (optional) Sync filters/search/page to URL params for shareable links |
| `data-algolia-match-mode="or"` | wrapper | (optional) Conditions matching logic between filter categories. Default (omit) = **AND** (narrow): an item must satisfy every selected category to appear. Set to `"or"` = **OR** (broad): an item matching any selected value across any category appears. Ranges (`data-algolia-range-*`) always stay AND with facets. |
| `data-algolia-search-mode="empty"` | wrapper | (optional) Start with no results — the list stays empty until the user types a query. Use on dedicated search pages where showing all records before any input is undesirable. |
| `data-algolia-debounce="300"` | wrapper | (optional) Debounce delay in milliseconds before search/range inputs fire a search. Default `300`. Higher values reduce API calls for fast typers. |
| `data-algolia-stagger="50"` | wrapper | (optional) Delay in milliseconds between each result item's entrance animation (fade in + slide up). Default `0` (no animation). Suggested: `30–60` subtle, `80–120` more visible. |

## Search

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-search` | `<input>` | Text search input (inside a wrapper) |
| `data-algolia-submit` | `<button>` / any | (optional) Adding this button switches the text query to **manual mode**: typing no longer searches instantly — the search runs only when the button is clicked or Enter is pressed. Filters and sort stay instant. Omit the button for instant search (default). |

## Global search box (navbar / standalone)

A standalone search input placed **outside** a `[data-algolia]` wrapper — e.g. in the navbar. It queries its own index independently and can redirect to a search page, show an autosuggest dropdown, or both.

### Input attributes

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-search-box` | `<input>` | Marks this as a standalone global search input |
| `data-algolia-app-id="..."` | `<input>` | Algolia Application ID |
| `data-algolia-api-key="..."` | `<input>` | Algolia Search-Only API key |
| `data-algolia-index="..."` | `<input>` | Index to query (e.g. `search_all`) |
| `data-algolia-search-action="..."` | `<input>` | `redirect` (default) · `dropdown` · `both` |
| `data-algolia-search-target="/search"` | `<input>` | URL of the results page (redirect/both mode). Default `/search` |
| `data-algolia-search-param="q"` | `<input>` | URL query param name. Default `q` |

### Autosuggest dropdown (dropdown / both mode)

Place a container with `[data-algolia-autosuggest]` near the input (sibling, parent, or anywhere on page). Inside it, put one child template element with `[data-algolia-autosuggest-template]`. Use `[data-algolia-bind]` inside the template exactly as in the main results list.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-autosuggest` | container div | Wrapper for the dropdown. Hidden by default; shown when suggestions exist |
| `data-algolia-autosuggest-template` | child element | Cloned once per suggestion result |
| `data-algolia-autosuggest-link` | `<a>` inside template | Automatically gets `href` set to the hit's `url` field |

### Minimal example

```html
<!-- Navbar search box -->
<div style="position:relative">
  <input
    type="text"
    placeholder="Search…"
    data-algolia-search-box
    data-algolia-app-id="YOUR_APP_ID"
    data-algolia-api-key="YOUR_SEARCH_KEY"
    data-algolia-index="search_all"
    data-algolia-search-action="both"
    data-algolia-search-target="/search"
  />

  <div data-algolia-autosuggest>
    <div data-algolia-autosuggest-template>
      <a data-algolia-autosuggest-link>
        <span data-algolia-bind="title"></span>
        <span data-algolia-bind="type"></span>
      </a>
    </div>
  </div>
</div>
```

> This standalone input redirects to (and/or previews results from) a dedicated search results page. For the full federated-search setup — the matching results page, the `search_all` index, and the sync — see [Feature B](#feature-b--federated-search-across-collections).

## Filters

> ⚠️ **Every attribute you filter by must be added as a Facet in Algolia.** Go to your index → **Configuration → Facets → Attributes for faceting** and add the field slug (e.g. `car-brand`, `featured`, `year`). Without this, the filter will silently return no results. After adding, click **Review and Save settings**.

> ⚠️ **Radio buttons in the same filter group must share the same `name` attribute.** This is how the browser knows they are mutually exclusive — selecting one auto-unchecks the others. Checkboxes do not need a shared `name`; each one is independent.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-filter="attr"` + `data-algolia-value="val"` | any (`<label>` recommended) | Click to filter. Auto-detects native `<input type="checkbox">` (multi-select) or `<input type="radio">` (single-select) inside. Same `attr` = OR; different attrs = AND. For boolean fields, use `"true"` or `"false"` as the value. |
| `data-algolia-filter-all="attr"` | `<label>` containing a radio | "All" option for a radio filter group. Clicking it clears all selections in that group. Auto-activates whenever no specific filter is selected, so it acts as the default state on page load. Only meaningful for radios (checkboxes already use "nothing checked" to mean "show all"). |
| `data-algolia-filter-select="attr"` | `<select>` | Dropdown filter. Empty option (`value=""`) clears the filter. |
| `data-algolia-range-min="attr"` | `<input type="number">` | Lower bound of a numeric range filter. Leave empty for open-ended. Field must be a **number** in Algolia. |
| `data-algolia-range-max="attr"` | `<input type="number">` | Upper bound of a numeric range filter. |
| `data-algolia-range-label="Price"` | range input | (optional) Custom prefix used in the active filter tag for this range. Default tag shows just the value (`Any – 2000`); with this set it shows `Price: Any – 2000`. Add to either min or max input. |

### Range slider (visual control on top of min/max inputs)

A draggable two-handle slider that drives the existing `data-algolia-range-min` / `data-algolia-range-max` inputs. Use it alongside (or instead of) the number inputs — both stay in sync.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-range-slider="attr"` | wrapper | Binds the slider to the same `attr` used by the number inputs. |
| `data-algolia-range-slider-min="0"` | wrapper | Lower bound of the slider scale. Required unless `auto-bounds` is set. |
| `data-algolia-range-slider-max="100000"` | wrapper | Upper bound of the slider scale. Required unless `auto-bounds` is set. |
| `data-algolia-range-slider-auto-bounds` | wrapper | (optional) Fetch the real min/max from Algolia facet stats on init. Attribute must be a numeric facet in Algolia. Explicit `min`/`max` always wins over auto-detected values. |
| `data-algolia-range-slider-step="100"` | wrapper | (optional) Snap increment. Default `1`. |
| `data-algolia-range-slider-format` | wrapper | (optional) Format the display spans using the browser's locale (`1,234,567`). Add a BCP 47 language tag to force a locale (`data-algolia-range-slider-format="fr-FR"` → `1 234 567`). |
| `data-algolia-range-slider-track` | child of wrapper | The bar element. |
| `data-algolia-range-slider-fill` | child of track | (optional) The highlighted section between handles. Auto-positioned. |
| `data-algolia-range-slider-handle="min"` | child of track | The lower handle (drag with mouse, touch, or pen). |
| `data-algolia-range-slider-handle="max"` | child of track | The upper handle. |
| `data-algolia-range-slider-display="min"` | any | Live text element showing the current lower value. Locale-formatted when `data-algolia-range-slider-format` is set. |
| `data-algolia-range-slider-display="max"` | any | Live text element showing the current upper value. |

> ⚠️ **The slider must coexist with `data-algolia-range-min` / `data-algolia-range-max` inputs for the same attribute** somewhere in the wrapper. The slider drives those inputs — they are the source of truth. You can hide them with `display:none` or `hidden` if you only want the slider visible.

**Two-way sync (automatic):**

- Dragging a handle updates the underlying number inputs.
- Typing into the number inputs moves the slider handles to match.
- Clicking a **Clear button** (`data-algolia-clear` or `data-algolia-clear="attr"`) resets both the inputs and the slider to the full bounds.
- Removing the active filter **tag** (`data-algolia-tag-remove`) also resets both the inputs and the slider.

**Static bounds (recommended):**

```html
<div class="filter_block">
  <!-- The number inputs the library reads. Keep visible for typing, or hide. -->
  <input type="number" data-algolia-range-min="price-number-2" data-algolia-range-label="Price" placeholder="min">
  <input type="number" data-algolia-range-max="price-number-2" placeholder="max">

  <div class="rangeslider_wrapper"
       data-algolia-range-slider="price-number-2"
       data-algolia-range-slider-min="0"
       data-algolia-range-slider-max="100000"
       data-algolia-range-slider-step="100"
       data-algolia-range-slider-format="en-US">

    <div class="rangeslider_track" data-algolia-range-slider-track>
      <div class="rangeslider_handle" data-algolia-range-slider-handle="min"></div>
      <div class="rangeslider_handle" data-algolia-range-slider-handle="max"></div>
      <div class="rangeslider_fill"  data-algolia-range-slider-fill></div>
    </div>

    <div class="range_values">
      <div>$<span data-algolia-range-slider-display="min">0</span></div>
      <div>$<span data-algolia-range-slider-display="max">100,000</span></div>
    </div>
  </div>
</div>
```

**Auto-bounds (one less thing to configure):**

```html
<div class="rangeslider_wrapper"
     data-algolia-range-slider="price-number-2"
     data-algolia-range-slider-auto-bounds
     data-algolia-range-slider-format>

  <div class="rangeslider_track" data-algolia-range-slider-track>
    <div class="rangeslider_handle" data-algolia-range-slider-handle="min"></div>
    <div class="rangeslider_handle" data-algolia-range-slider-handle="max"></div>
    <div class="rangeslider_fill"  data-algolia-range-slider-fill></div>
  </div>

  <div class="range_values">
    <div>$<span data-algolia-range-slider-display="min"></span></div>
    <div>$<span data-algolia-range-slider-display="max"></span></div>
  </div>
</div>
```

**Tradeoff to know:** auto-bounds fires one extra Algolia query on page load and uses the real min/max from your data (e.g. `$12,347 – $487,250`). Static bounds let you round to clean numbers (`$0 – $500,000`) but you have to maintain them as your data grows.

#### Required Webflow styling for the slider

The library only positions the handles and fill via `style.left` / `style.width` percentages — visual styling is up to you. Minimum CSS to make the slider work visually:

```css
.rangeslider_track    { position: relative; height: 4px; background: #e5e7eb; }
.rangeslider_handle   { position: absolute; top: 50%; width: 16px; height: 16px;
                         margin-left: -8px; transform: translateY(-50%);
                         background: #6c2bd9; border-radius: 50%; cursor: grab; z-index: 2; }
.rangeslider_handle:active { cursor: grabbing; }
.rangeslider_fill     { position: absolute; top: 0; height: 100%;
                         background: #6c2bd9; z-index: 1; }
```

Adjust colors and sizing to match your design.

## Sort

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-sort` | `<select>` (Webflow Form Select field) | Each option's `value` should be the name of an Algolia index replica (e.g. `cars_price_asc`). See [Step 9](#step-9--optional-configure-sorting) for full setup. Must be a native `<select>` — Webflow's navigation "Dropdown" component will not work. |

## Clear buttons

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-clear` | any | Clears ALL filters, search query, and sort |
| `data-algolia-clear="attr"` | any | Clears only the specified filter group |

## Result list

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-list` | container | Where result items get injected |
| `data-algolia-template` | `<div>` or `<template>` | Cloned once per result (inside the list container). A regular `<div>` is fine — it's hidden automatically. |
| `data-algolia-bind="field"` | any (inside template) | Sets the element's text content from the Algolia hit. Supports dot notation: `image.url`, `car-brand__logo.url`. |
| `data-algolia-bind="field"` + `data-algolia-attr="name"` | any (inside template) | Sets an attribute (`src`, `href`, `alt`, etc.) instead of text content. |
| `data-algolia-bind="field"` + `data-algolia-bind-format="date"` | any (inside template) | Formats the field as a human-readable date (e.g. `"June 10, 2024"`). Accepts a Webflow CMS ISO string (`"2026-06-25T18:30:00.000Z"`) or a Unix timestamp in seconds (`1718000000`). Renders nothing when the value is `0`, empty, or invalid — safe for records with no date. |
| `data-algolia-hide-empty="field"` | any (inside template) | Hides this element when the bound field is empty, null, or an empty array. |

## Repeat (multi-value fields)

For arrays / multi-reference fields where each value should render as a separate element:

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-repeat="field"` | container | Renders one child per array value |
| `data-algolia-repeat-item` | child (inside repeat container) | Template element cloned per array value. Its text content gets set to each value — no `data-algolia-bind` needed or allowed. |

```html
<div data-algolia-hide-empty="authors" data-algolia-repeat="authors">
  <span data-algolia-repeat-item class="author-tag"></span>
</div>
```

### Filtering multi-reference fields

Multi-reference fields (stored as arrays in Algolia) are fully filterable. Algolia indexes each value in the array individually, so a filter on one value matches any item where that value appears anywhere in the array.

**Step 1 — Add the field as a Facet in Algolia**

Go to your index → **Configuration → Facets → Attributes for faceting** and add the field slug (e.g. `authors`). Without this step, the filter returns zero results silently.

**Step 2 — Add filter elements as normal**

Use `data-algolia-filter` + `data-algolia-value` exactly as you would for any other field:

```html
<!-- Checkbox: multi-select (show items by any selected author) -->
<label data-algolia-filter="authors" data-algolia-value="Charles Miller">
  <input type="checkbox"><span>Charles Miller</span>
</label>
<label data-algolia-filter="authors" data-algolia-value="Emily Davis">
  <input type="checkbox"><span>Emily Davis</span>
</label>

<!-- Or a dropdown -->
<select data-algolia-filter-select="authors">
  <option value="">All authors</option>
  <option value="Charles Miller">Charles Miller</option>
  <option value="Emily Davis">Emily Davis</option>
</select>
```

The search input also works across multi-reference fields — add the field to **Searchable Attributes** in Algolia and the text search will match against all values in the array.

## Stats & empty state

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-count` | any | Displays total number of matches (e.g. `1,786`) |
| `data-algolia-query` | any | Displays the current search query text. Handy for "Results for *X*" headings on a search page. Empty when there's no active query. |
| `data-algolia-empty` | any | Shown only when there are no results |

## Pagination

Three independent options — pick whichever fits your layout:

| Option | Attributes | Behavior |
|---|---|---|
| **Load More** | `data-algolia-load-more` | Appends next page to existing results. Never replaces. |
| **Previous / Next** | `data-algolia-prev` `data-algolia-next` `data-algolia-page-info` | Replaces results. Standard back/forward navigation. |
| **Numbered pages** | `data-algolia-pages` + templates | Replaces results. Lets user jump to any page. Supports dots and responsive siblings/boundaries. |

You can combine **Previous / Next** with **Numbered pages** (common pattern). Avoid combining **Load More** with the others — it would create confusing UX since Load More appends while the others replace.

### Load More button

Appends the next page of results to the existing list without replacing it. Auto-hides when there are no more pages.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-load-more` | any | Clicking appends the next page. Hides automatically on the last page. Changing filters/search/sort resets the list normally. |

```html
<button data-algolia-load-more>Load more</button>
```

> **Note:** Algolia caps pagination at 1,000 total results by default. If you need more, increase `paginationLimitedTo` in Algolia → your index → Configuration → Pagination. Also keep `data-algolia-hits-per-page` reasonable (12–24) to avoid accumulating too many DOM nodes.

### Previous / Next buttons

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-prev` | any | Click → previous page. Auto-disabled on first page. |
| `data-algolia-next` | any | Click → next page. Auto-disabled on last page. |
| `data-algolia-page-info` | any | Displays "Page X of Y" |

### Numbered page buttons (with siblings, boundaries, and dots)

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-pages` | container | Where numbered page buttons get injected |
| `data-algolia-page-button-template` | child of pages container | Cloned for each visible page number. Active page gets `data-active=""` for styling. |
| `data-algolia-page-dots-template` | child of pages container | (Optional) Cloned to render the "..." separator when pages are skipped due to siblings/boundaries logic. |
| `data-algolia-page-siblings="2,1,1,0"` | pages container | Number of pages shown on each side of the current page. Comma-separated for Webflow breakpoints (Desktop, Tablet, Landscape, Portrait). Default `1`. Single value (`"1"`) applies everywhere. |
| `data-algolia-page-boundaries="1,1,1,0"` | pages container | Number of pages always shown at the start and end of the pagination. Same comma-separated breakpoint syntax. Default `1`. |

Example:

```html
<div
  data-algolia-pages
  data-algolia-page-siblings="2,1,1,0"
  data-algolia-page-boundaries="1,1,1,0"
>
  <button data-algolia-page-button-template class="page-btn">1</button>
  <span data-algolia-page-dots-template class="page-dots">…</span>
</div>
```

Style the active page in Webflow's custom CSS:

```css
[data-algolia-page-item][data-active] { background: #6c2bd9; color: white; }
```

The page list re-renders automatically on window resize so the responsive siblings/boundaries kick in correctly.

## Active filter tags

Renders one element per active filter, with an X button to remove individual filters.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-tags` | container | Where tags get injected |
| `data-algolia-tag-template` | child of tags container | Cloned once per active filter |
| `data-algolia-tag-label` | any (inside tag template) | Gets the filter value as text (e.g. "Quasar", "White") |
| `data-algolia-tag-remove` | any (inside tag template) | Clicking removes that filter. If missing, the whole tag is clickable. |

## Scroll anchor

Scrolls the page to a specific element on every filter, search, sort, or pagination change. Useful for long pages or sticky headers where filter results would otherwise be scrolled off-screen.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-scroll-anchor` | any | Scrolls smoothly to this element on every filter change. Can be **inside or outside** the `[data-algolia]` wrapper. Skipped on initial page load to avoid an unexpected jump. |

```html
<!-- Place above the results section -->
<div data-algolia-scroll-anchor></div>
```

## Active filter styling

When a filter is selected, the library adds `data-active=""` to the label element. Style it in Webflow's custom CSS:

```css
[data-algolia-filter][data-active] { /* active state */ }
```

For Webflow's native checkbox/radio components, the library also toggles their built-in `w--redirected-checked` class, so visual styling works out of the box.

---

# Common patterns

## How CMS fields appear in Algolia

The Webflow API returns field **slugs** (lowercase, hyphenated), not display names:

| Webflow Designer (display name) | API slug (Algolia field) |
|---|---|
| Product Name | `name` |
| Car Make | `car-make` |
| Featured? | `featured` |

Use these slugs in `data-algolia-bind`, `data-algolia-filter`, etc.

## Reference fields (link to another collection)

The sync resolves **single Reference fields** to the referenced item's name automatically:

| Field type | What's stored in Algolia |
|---|---|
| Single reference | `"Quasar"` (the name of the referenced item) |
| Multi-reference | `["Charles Miller", "Emily Davis"]` |

It also stores **all sub-fields** of the referenced item as `field__subfield`. For example:

```html
<!-- Display the brand logo from the referenced "Car Brand" collection -->
<img data-algolia-bind="car-brand__logo.url" data-algolia-attr="src">
```

## Option fields (single/multi-select dropdowns)

Stored as the option's name (e.g. `"White"`), not its internal ID. Use the name in your filter values.

## Boolean fields (Switch / toggle)

Webflow "Switch" fields are stored as real booleans in Algolia (`true` / `false`). Use the string `"true"` or `"false"` as the filter value:

```html
<!-- Toggle ON = show only featured items -->
<label data-algolia-filter="featured" data-algolia-value="true" class="filter_toggle">
  <input type="checkbox">
  <span>Featured only</span>
</label>
```

Toggle off = no filter = shows everything.

## Image fields

```html
<img data-algolia-bind="image.url" data-algolia-attr="src">
```

## Hiding empty elements

```html
<div data-algolia-hide-empty="authors" data-algolia-repeat="authors">
  <span data-algolia-repeat-item></span>
</div>
```

The wrapping `.card_item` hides entirely if the field is empty.

## Setting a default active filter

On page load, the library reads the initial `checked` / `selected` state of inputs and applies it as the starting filter state.

**Default to "All"** — just add `data-algolia-filter-all="attr"` to the All option. It auto-activates whenever no specific filter is selected, including the initial page load. No `checked` attribute needed.

```html
<label data-algolia-filter-all="car-brand">
  <input type="radio" name="brand">
  <span>All brands</span>
</label>
```

**Default to a specific filter** — add `checked` to the input. Either in HTML or by toggling **Default state: Checked** in Webflow Designer's element settings.

```html
<label data-algolia-filter="car-brand" data-algolia-value="Quasar">
  <input type="radio" name="brand" checked>
  <span>Quasar</span>
</label>
```

Same works for `<option selected>` inside a `data-algolia-filter-select` dropdown.

**Priority:** URL state (if `data-algolia-url-state` is on the wrapper and the URL contains filter params) > HTML defaults > nothing.

---

# Using this template for multiple projects

You do **not** need to fork or duplicate this repository for every new Webflow site you build with it. Each piece has its own reusability story:

| Piece | Reusable across projects? | What to do for each new project |
|---|---|---|
| **Client library** (`<script>` tag) | ✅ Fully reusable | Paste the same official jsDelivr `<script>` tag. Each site provides its own credentials via `data-algolia-app-id`, `data-algolia-api-key`, `data-algolia-index`. |
| **Webhook worker** (Cloudflare) | ✅ Code is reusable | Create a separate Cloudflare Worker per project and paste the same `apps/webhook-worker/src/index.js`. Each Worker gets its own environment variables (different Algolia index + Webflow collection ID). |
| **Sync app** (Webflow Cloud) | ✅ Code is reusable for Feature A | Create a separate Webflow Cloud app per Webflow site. You can point multiple apps at the **same template repository** — isolated environment variables let the same code drive different filter indexes/collections. **Feature B caveat:** the federated sources live in `search-all-config.ts` (committed code, not env vars), so projects with *different* federated setups need their own repo copy — see below. |

**Per-project resources you always need to create fresh:**

- A dedicated Algolia index
- A dedicated Webflow Cloud app (with its own environment variables)
- A dedicated Cloudflare Worker (with its own environment variables)
- Webflow webhooks pointing at that project's Cloudflare Worker URL

## When you should fork the repository

Use the official template directly when the code works for you as-is. Fork (or create your own copy via **Use this template**) only if you need to:

- **Use federated search (Feature B) with project-specific sources** — `search-all-config.ts` is committed code, so each site with a different set of collections/pages needs its own copy of the repo.
- **Modify the sync logic** — e.g. transform fields differently for a specific project, add custom enrichment, change how reference fields are flattened.
- **Pin different versions per project** — e.g. keep one client on an older sync deployment while another tracks the latest.
- **Keep an isolated commit history** for a specific client or site (e.g. for audit or handover reasons).

In short: **shared code, isolated infrastructure**. One template repository can power any number of Webflow projects as long as the sync logic doesn't need to change.

---

# Debugging with the Inspector

The library ships with a built-in **Inspector** that audits your page for common configuration mistakes — missing wrapper attributes, mismatched range pairs, broken slider setups, pagination conflicts, and more. It only loads on staging (`*.webflow.io`) and local development hosts, and only when you explicitly opt in.

## Activate it

Append `?algolia-debug` to your staging URL:

```
https://your-site.webflow.io/cars?algolia-debug
```

You'll see:

- A floating **Algolia Inspector** badge in the bottom-right corner. A red or yellow dot indicates issues were found; green means clean.
- All elements with `data-algolia*` attributes get a cyan outline on the page.
- A small **tooltip** appears next to your cursor showing the exact attribute(s) and value(s) on whatever element you hover.

Click the badge to open the diagnostic panel. Each issue is clickable and scrolls you to the offending element.

## Controls

| Action | Result |
|---|---|
| `?algolia-debug` in URL | Loads the Inspector for this page |
| Remove the param (or refresh without it) | Inspector unloads |
| Click the floating badge | Opens / closes the diagnostic panel |
| Toggle "Outline" checkbox in the panel | Shows / hides the cyan outlines + tooltips |
| `Shift + ?` keyboard shortcut | Same as toggling outline |
| Click any issue in the panel | Smoothly scrolls to the offending element and pulses an outline around it |

## What it checks

| Category | Checks |
|---|---|
| **Wrapper** | `[data-algolia]` exists; required `data-algolia-app-id`, `data-algolia-api-key`, `data-algolia-index` present; `data-algolia-match-mode` is `"and"` or `"or"` |
| **Templates** | `[data-algolia-list]` and `[data-algolia-template]` both exist; template contains at least one `data-algolia-bind`; `data-algolia-attr` always paired with `data-algolia-bind`; `data-algolia-bind` / `-hide-empty` not left with empty values; `data-algolia-repeat-item` lives inside a `data-algolia-repeat` |
| **Filters** | `data-algolia-filter` paired with `data-algolia-value`; orphan `data-algolia-value` (no parent filter) flagged; radio groups consistent — if any radio is wired up, every radio in that `name` group must be too (`data-algolia-filter` or `data-algolia-filter-all`); radios in the same filter share a `name`; non-empty values for `data-algolia-filter-select` / `-filter-all` |
| **Range** | Every `data-algolia-range-min="attr"` has a matching `data-algolia-range-max="attr"` (and vice versa) |
| **Range Slider** | Has either static `min`/`max` OR `auto-bounds`; track + both handles present; matching number inputs in the wrapper |
| **Pagination** | Load More not combined with numbered Pages; `[data-algolia-pages]` has a button template; page templates live inside `[data-algolia-pages]` |
| **Tags** | `[data-algolia-tags]` has a `[data-algolia-tag-template]` child; tag children (`-tag-label`, `-tag-remove`) live inside the template |

## Staging-only by design

The Inspector never runs in production. It checks the URL parameter, the hostname, and only initializes if both match — so even with `?algolia-debug` on a custom-domain production site, nothing happens. Safe to ship.

---

# Operations

## Re-running the sync (after schema changes)

After adding new fields, new collections, or modifying references in Webflow, run a full sync of whichever feature(s) you use:

```bash
# Feature A — filter index
curl -X POST https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"

# Feature B — federated search index
curl -X POST https://YOUR_SITE.webflow.io/api/search-all \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Or **just publish the site** — the `site_publish` webhook re-runs every configured endpoint automatically.

> After editing `search-all-config.ts` (adding a collection, changing a field mapping), **deploy the sync app** first, then re-run `/api/search-all`.

## Clearing the index

In Algolia → your index → **Manage index → Clear index** → type `CLEAR`. Then re-run the sync.

## Updating the library version

When a new version is released, update the version tag in the script URL:

```html
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.8.13/packages/library/dist/algolia-webflow.min.js"></script>
```

Then **hard refresh** (Cmd/Ctrl+Shift+R) to bypass the browser cache.

## Inspecting the synced data

```bash
curl -s "https://YOUR_APP_ID-dsn.algolia.net/1/indexes/YOUR_INDEX?hitsPerPage=1" \
  -H "X-Algolia-Application-Id: YOUR_APP_ID" \
  -H "X-Algolia-API-Key: YOUR_SEARCH_KEY"
```

## Inspecting the Webflow collection schema

```bash
curl -X PUT https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Returns the raw schema — useful for debugging field types and resolving issues.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Page shows wrong filter values, only ~100 items | Old version of `@main` cached by jsDelivr | Always pin to a `@v0.x.x` tag, not `@main` |
| New library changes not appearing | Browser cache | Hard refresh (Cmd/Ctrl+Shift+R) |
| Webhook URL rejected: "Invalid hostname" | Webflow blocks `*.webflow.io` webhooks | Use the Cloudflare Worker URL instead |
| Items from other collections appear in Algolia | Webhook fires for all collections | Set `WEBFLOW_COLLECTION_ID` in the Cloudflare Worker |
| Reference field shows an ID instead of name | Old sync, or new reference field | Re-run sync (or publish the site) |
| Search results show no image | Bound `image.url` instead of `image` | In the federated index `image` is a plain URL string — bind `data-algolia-bind="image"` (Feature B) |
| Search index never updates on edits | `SEARCH_ALL_ENDPOINT` missing or pointing at the wrong domain | Set it on the worker to the **live** sync-app domain (`https://YOUR_SITE.webflow.io/api/search-all`) and re-deploy the worker |
| New collection / field mapping not reflected in search | `search-all-config.ts` edited but app not redeployed | Deploy the sync app, then re-run `POST /api/search-all` |
| Search results page is blank on load | `data-algolia-search-mode="empty"` is set | Expected — results appear once the visitor types. Remove the attribute to show everything by default |
| Webflow Cloud deploy fails (`Cannot find package esbuild`) | Webflow Cloud installs with `--omit=dev` | All build-time deps must be regular dependencies (already configured in the template) |
| Webflow Cloud deploy succeeds but routes 500 | Next.js 16.2+ Turbopack output crashes on Workers | Already pinned to ~16.1 with `next build --webpack` |

---

# Project structure

```
algolia-webflow-filter/
├── apps/
│   ├── sync/                          # Next.js app for Webflow Cloud
│   │   └── src/
│   │       ├── search-all-config.ts   # Feature B — EDIT THIS: collections + static pages
│   │       └── app/
│   │           ├── sync/route.ts          # POST /api/sync — Feature A full paginated sync
│   │           │                          # GET  /api/sync — health check
│   │           │                          # PUT  /api/sync — schema dump (debug)
│   │           ├── search-all/route.ts    # POST /api/search-all — Feature B federated sync (generic)
│   │           └── webhook/route.ts       # POST /api/webhook (unused — use Cloudflare Worker instead)
│   │
│   └── webhook-worker/                # Cloudflare Worker
│       └── src/index.js               # Per-item sync + full sync on site_publish
│
└── packages/
    └── library/                       # Client-side library (filtering + federated search)
        ├── src/index.ts               # Source
        └── dist/algolia-webflow.min.js  # Built (served via jsDelivr)
```
