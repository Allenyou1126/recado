# Waline Comment System — Feature Inventory / Requirements Baseline

> **归档说明（本仓库整理时补记）**
> 本报告是一次性研究产物，**保留原始内容不改**，仅更正路径信息：
> 核查时使用的 `walinejs/waline` 源码克隆（`.research/waline-src`，79 MB）与本目录下的
> GitHub API 临时数据已在本仓库整理时删除。正文中凡出现 `.research/waline-src` 处，
> 均指该已删除的临时克隆。
> **需要复核时按下列命令重建**（commit 与下文一致）：
> ```bash
> git clone --depth 1 https://github.com/walinejs/waline /tmp/waline-src
> git -C /tmp/waline-src log -1 --format=%H   # 期望：43a1e85edcb07b03e26713223eb89dd81cbaa0c4
> ```
> 结论层面无需重建即可采信：所有判断均已在正文标注证据来源（源码 / 文档 / 未核实）。

**Purpose:** factual feature inventory of the Waline comment system, to serve as a requirements baseline for designing a NEW comment system inspired by it.

**Verification method & provenance.** Most claims below were verified by reading the actual source of the `walinejs/waline` monorepo, shallow-cloned at commit `43a1e85edcb07b03e26713223eb89dd81cbaa0c4` (2026-09-14). A full clone is available in this workspace at `.research/waline-src`. Package versions at that commit: `@waline/client@3.15.2`, `@waline/server` (published as `@waline/vercel`) `@1.41.6`, `@waline/admin@0.34.2`, `@waline/api@1.1.2`. Official docs markdown lives in the same repo under `docs/src/<locale>/`, and the published URLs were confirmed to resolve (HTTP 200). Where a claim comes only from documentation and not from source (or vice versa), it is marked. Anything I could not verify is explicitly marked **unverified**.

> Note on staleness: the repo's `CHANGELOG.md` stops at 2023-05-27 and the English docs lag the code in places (e.g. the i18n doc lists 18 languages while the code ships 23 language tags / 13 locale bundles; the server API doc omits several live endpoints). Where docs and code disagree, I trust the code and say so.

---

## 1. Commenter-facing features — `@waline/client`

### 1.1 Distribution / entry points

`packages/client/package.json` `exports` map defines these bundles (this is the real public surface):

| Subpath | File | Contents |
| --- | --- | --- |
| `.` (default) | `dist/slim.js` | slim build — `init` only |
| `./component` | `dist/component.js` | the `Waline` Vue SFC only |
| `./full` | `dist/waline.js` (ESM) / `dist/waline.umd.js` | everything: api re-exports, init, commentCount, pageviewCount, widgets, defaultLocales, version |
| `./comment` | `dist/comment.js` / `.umd.js` | standalone comment-counter module (claimed < 1 KB gzip) |
| `./pageview` | `dist/pageview.js` / `.umd.js` | standalone pageview module (claimed < 1 KB gzip) |
| `./style` / `./waline.css` | `dist/waline.css` | main stylesheet |
| `./meta` / `./waline-meta.css` | `dist/waline-meta.css` | optional "meta line" (addr/browser/os) stylesheet |

Runtime deps of the client: `vue`, `@vueuse/core`, `@waline/api`, `marked` + `marked-highlight`, `autosize`, `recaptcha-v3`, `@webc.site/math` (TeX→MathML).

Public factory functions (from `entries/full.ts`): `init`, `commentCount`, `pageviewCount`, `RecentComments`, `UserList`, `Star`, `defaultLocales`, `version`, plus a full re-export of `@waline/api`.

`init()` returns a `WalineInstance` with exactly three members: `el: HTMLElement | null`, `update(newOptions?)`, `destroy()`.

### 1.2 Full `WalineInitOptions` surface

`WalineInitOptions` (`packages/client/src/typings/options.d.ts`) extends `Omit<WalineProps, 'path'|'emoji'|'search'|'highlighter'|'imageUploader'|'texRenderer'>` and re-adds those six plus three more. **24 fields total**:

| Option | Type | Default (from `utils/config.ts` `getConfig`) | Notes |
| --- | --- | --- | --- |
| `el` | `string \| HTMLElement \| null` | `'#waline'` | init-only |
| `serverURL` | `string` | *required* | throws `"Option 'serverURL' is missing!"` if absent; `https://` is prepended if no scheme; trailing slash stripped |
| `path` | `string` | `window.location.pathname` | article identity; `decodePath()`-normalised |
| `comment` | `string \| boolean` | `false` | init-only; `true` → auto-update `.waline-comment-count`; a string → custom selector |
| `pageview` | `string \| boolean` | `false` | init-only; same pattern for `.waline-pageview-count` |
| `meta` | `('nick'\|'mail'\|'link')[]` | `['nick','mail','link']` | which identity inputs to show; unknown values filtered out |
| `requiredMeta` | `('nick'\|'mail'\|'link')[]` | `[]` | which inputs are mandatory |
| `wordLimit` | `number \| [number, number]` | *none / no limit* | single number → `[0, n]`; only a positive number enables it |
| `pageSize` | `number` | `10` | |
| `lang` | `string` | `navigator.language` | normalised via `getLang()`; unknown → `en-US` |
| `locale` | `Partial<WalineLocale>` | *none* | shallow-merged over the selected built-in |
| `commentSorting` | `'latest'\|'oldest'\|'hottest'` | `'latest'` | |
| `dark` | `string \| boolean` | `false` | `true` → `:root`; `'auto'` → `prefers-color-scheme`; other string → used as a CSS selector ancestor scope |
| `login` | `'enable'\|'disable'\|'force'` | `'enable'` | `'force'` hides the submit button unless logged in |
| `noCopyright` | `boolean` | `false` | hides "Powered by Waline vX" footer |
| `noRss` | `boolean` | `false` | hides all RSS links |
| `recaptchaV3Key` | `string` | `''` | client key; token attached to the comment payload |
| `turnstileKey` | `string` | `''` | Cloudflare Turnstile client key |
| `reaction` | `string[] \| boolean` | `false` | `true` → 6 default Tieba PNGs |
| `emoji` | `(WalineEmojiInfo \| WalineEmojiPresets)[] \| boolean` | `['//unpkg.com/@waline/emojis@1.1.0/weibo']` | `false` disables; presets are `//…`, `http://…`, `https://…` strings or `{name, folder?, prefix?, type?, icon, items[]}` objects |
| `search` | `WalineSearchOptions \| boolean` | Giphy wrapper (hardcoded public API key) | `{search, default?, more?}` returning `{src, title?, preview?}[]` |
| `highlighter` | `WalineHighlighter \| boolean` | built-in Prism-based local highlighter | `(code, lang) => string` |
| `imageUploader` | `(file: File) => Promise<string> \| boolean` | base64 `FileReader`, **hard 128 KB limit** | client-side only; see §1.9 |
| `texRenderer` | `(blockMode, tex) => string \| boolean` | `@webc.site/math` → MathML | preview-side rendering |

Non-obvious behaviours worth carrying over or deliberately changing:
- `emoji`, `search`, `highlighter`, `imageUploader`, `texRenderer` use a tri-state `withFallback` helper: `undefined`/`true` → default, `false` → `null` (feature off), otherwise the supplied value.
- `requiredMeta` interacts with `meta`: a field not in `requiredMeta` while `requiredMeta` is non-empty gets an "(optional)" suffix in its label.
- `getServerURL()` silently prepends `https://` when the scheme is missing, but `isLinkHttp` only checks `http(s)://` — a protocol-relative `//host` gets `https://` prepended.

### 1.3 Comment list rendering

`components/WalineComment.vue` is the root. Rendering model:
- Root comments are fetched into `data: WalineRootComment[]`, and `CommentCard` renders each.
- Comment bodies are injected with `v-html="comment.comment"` — i.e. **the server stores/returns rendered HTML**, not markdown. `orig` (raw markdown) is only returned to a logged-in user for their own comment (see §4).
- Each root card renders: avatar `<img>`, a `guest`/`administrator` type icon, nick (wrapped in `<a rel="ugc nofollow noreferrer noopener" target="_blank">` when a link exists, `https://` prepended if schemeless), an optional `label` badge, a "sticky" badge, an optional `levelN` badge, a relative timestamp.
- A "meta" line under the head renders `addr`, `browser`, `os` if present (this is what `waline-meta.css` styles).
- A `wl-warning` block shows `commentUnderReview` when `status === 'waiting'` **and the viewer is not an admin**.
- Empty state uses the locale string `sofa`; a `refresh` button appears on error.
- Reply chain display: a child comment with `reply_user` shows `@nick:` above its body, linking to `#<pid>`.
- No virtualization, no infinite scroll — the list is append-only via a "more" button (see §1.5).
- Loading is guarded by an `AbortController`; a new fetch aborts the previous one.

### 1.4 Reply nesting and max depth

**Maximum depth is 2 levels: one root comment plus a flat list of children.** There is no configurable `maxDepth` option and no deep threading.

Mechanism: `WalineRootComment` has `children: WalineChildComment[]`; `WalineChildComment` has `pid`, `rid`, `at?`, `reply_user?` — but **no** `children`. `CommentCard.vue` renders `v-if="'children' in comment"` and recurses, so a child never recurses further. On submit, replying to any comment sets `comment.pid = replyId` and `comment.rid = rootId`, i.e. all descendants collapse to the same root.

Server-side, `getCommentList()` reads only two sets: root comments (`rid: undefined`) for the page window, then **all** comments whose `rid IN (pageRootIds)` in a single unbounded query. Consequences: every reply on a page is loaded at once (no pagination of replies), and reply order is forced by `.reverse()` on the child array (ascending by the underlying insert order).

### 1.5 Sorting, pagination, page size

Sorting: `commentSorting` maps via `sortKeyMap` to a wire value sent as `sortBy`:

| Client value | Wire `sortBy` | Ordering |
| --- | --- | --- |
| `latest` (default) | `insertedAt_desc` | newest first |
| `oldest` | `insertedAt_asc` | oldest first |
| `hottest` | `like_desc` | most-liked first |

The sort control is a 3-item `<ul class="wl-sort">`; changing it resets and refetches from page 1. In all cases the server additionally orders `sticky DESC NULLS LAST` first, then the sort field, then `objectId`.

Pagination: `pageSize` default 10, server-capped at 100 (`logic/comment.js` `pageSize: {int: {max: 100}}`). The UI has **only a "load more" button** (`i18n.more`) shown while `page < totalPages` — there are no numbered pages, no page-jump. `loadMore()` appends `resp.data` to the existing array and increments `page`. There is a known open feature request for numbered pagination ([#3203](https://github.com/walinejs/waline/issues/3203)).

Response envelope for the list (`GetCommentResponse`): `{count, page, pageSize, data, totalPages}` where `count` is the **total comment count including replies** and `totalPages` is computed from the **root-comment count only** (`Math.ceil(rootCount / pageSize)`).

### 1.6 Markdown support

- The **server** renders markdown to sanitized HTML (`service/markdown/index.js`), using `markdown-it` with `breaks: true`, `linkify: true`, `typographer: true`, and `html: true` forced on (because parsed emoji need it).
- Plugins enabled by default: `@mdit/plugin-emoji` (`fullEmoji`), `@mdit/plugin-sub`, `@mdit/plugin-sup`, and TeX via `@mdit/plugin-mathjax` (default) or `@mdit/plugin-katex` — selected by `MARKDOWN_TEX`. MathJax renders `svg`, KaTeX renders `mathml`.
- Syntax highlighting in the *store step* uses PrismJS (`service/markdown/highlight.js`).
- Sanitisation is DOMPurify over jsdom (`service/markdown/xss.js`), with `FORBID_TAGS: ['form','input','style']` and `FORBID_ATTR: ['autoplay','style']` (both overridable via the `domPurify` server config). Hooks force `target="_blank"` + `rel="ugc nofollow noreferrer noopener"` on anything with `href`, set `xlink:show="new"`, set `preload="none"`, and strip `<annotation>` (MathML edge case, issue #3238).
- The **client** separately renders a *preview* using `marked` + `marked-highlight` + the configured `highlighter`/`texRenderer`, and it also parses `:emoji:` shortcodes into `<img>` before preview. So markdown parsing exists in two places with two different parsers — a duplication worth avoiding in a new design.
- The client shows a static "Markdown is supported" link to GitHub's markdown guide; there is no toolbar.

### 1.7 Emoji panel and custom emoji

- `utils/emoji.ts` `getEmojisInfo(emoji)` builds `{tabs: {name, icon, items}[], map: Record<key, url>}`.
- Presets are resolved by convention: given `//unpkg.com/@waline/emojis@1.4.0/weibo`, the client fetches `…/info.json` for tab metadata and constructs per-emoji URLs as `{folder}{prefix}{name}.{type}` (defaults: `folder` = the preset URL itself, `type` = `png`).
- The panel is a popup with tab buttons (only shown when `tabs.length > 1`), an emoji grid with hover preview positioned relative to the popup, and lazy `loading="lazy"` + `referrerPolicy="no-referrer"` images.
- Clicking inserts the literal `:key:` into the textarea; the server-side `@mdit/plugin-emoji` resolves shortcodes at render time.
- Official presets documented: Alus, Bmoji, Bilibili, QQ, Tieba, Twemoji (`tw-emoji`, plus sub-sets `tw-body`, `tw-food`, `tw-natural`, `tw-object`, `tw-symbol`, `tw-people`, `tw-sport`, `tw-time`, `tw-travel`, `tw-weather`, `tw-flag`, and the discouraged full `tw`), Weibo, Soul knight (`soul-emoji`). Default is Weibo.
- A single site-configured emoji set only — no per-user or per-post emoji packs. Improving the emoji system is an open request ([#3515](https://github.com/walinejs/waline/issues/3515)).

### 1.8 GIF / image search panel

A separate GIF button toggles a popup with a search input and an infinitely-scrolling image wall (`ImageWall.vue`, `column-width: 200`, `gap: 6`). Default backend is the **Giphy public API inlined in the client** with a hardcoded demo API key (`6CIMLkNMMOhRcXPoMCPkFy4Ybk2XUiMp`), `rating=g`, `limit=20`. Debounced 300 ms; paging via `search.more(word, currentCount)`. Configurable via `search`.

### 1.9 Image upload

- **Purely client-side. There is no server upload endpoint** (confirmed: no `upload` route or controller in `packages/server`; the docs' upload cookbook tells you to bring your own image host).
- Default `imageUploader` reads the file as a **base64 data URL** and **rejects files over 128 KB** with `"File too large! File size limit 128KB"` — the base64 string becomes part of the comment markdown/HTML. (Issue [#2120](https://github.com/walinejs/waline/issues/2120) is this behaviour surfacing.)
- Real deployments supply their own `imageUploader` posting to an external image host (the docs demo uses lsky-pro).
- Triggers: file input (`accept=".png,.jpg,.jpeg,.webp,.bmp,.gif"`), drag-and-drop onto the textarea, and paste from clipboard. During upload a placeholder `![Uploading name]()` is inserted and replaced with the final URL; on error an `alert()` fires.
- No avatar upload (open request [#2677](https://github.com/walinejs/waline/issues/2677)) — avatars are Gravatar/QQ-derived or set by URL in the profile page.

### 1.10 Comment like ("reactions" per comment)

- Per-comment `like` counter, incremented/decremented through `PUT /api/comment/:id` with body `{like: boolean}`.
- **Liking requires no authentication** (`logic/comment.js` `putAction` explicitly early-returns when the body is exactly `{like}`).
- De-duplication is **client-side only**: `useLikeStorage()` persists an array of liked `objectId`s under localStorage key `WALINE_LIKE`, capped to the most recent 50 entries. Clearing storage lets a user like again; there is no server-side per-user like record. This is a significant integrity weakness for a new design.
- Anti-abuse: the server adds `+Math.ceil(Math.random() * LIKE_INC_MAX)` on a like (default `LIKE_INC_MAX = 1`) and `-1` on un-like, clamped at 0. The randomness exists to make like counts less trivially forgeable/detectable.
- The UI shows a filled/outlined heart with the count; tooltip toggles between `like` / `cancelLike`.

### 1.11 Article reactions

- Configured by `reaction: string[] | true` (URLs of reaction images). **Maximum 9** (locale defines `reaction0`…`reaction8` and the `Counter` table has `reaction0`…`reaction8`).
- Rendered by `ArticleReaction.vue` **above the comment box**.
- Storage is the shared article counter row: reactions are `reaction{N}` integer columns keyed by `url`, incremented/decremented via `POST /api/article` with `type: "reactionN"` and `action: 'inc'|'desc'`.
- Exactly one reaction per article per browser, tracked in localStorage key `WALINE_REACTION` as `{[path]: index}`. Switching decrements the old and increments the new. Again client-side only.
- Explicit documented caveat: **counting is positional** — reordering or removing reactions in the array silently reassigns existing counts ([#1451](https://github.com/walinejs/waline/issues/1451)).

### 1.12 Star rating widget (`Star`)

Newer addition (`widgets/star/`). `Star({el, path, lang, serverURL, onRate})` renders a 5-star rating; it **reuses `reaction0`…`reaction4`** of the same article counter row, so it cannot coexist with a 5+ item article `reaction` config on the same path. Also stores the user's own choice in `WALINE_REACTION`. Implies a per-article unauthenticated, position-indexed rating — same integrity caveats as §1.11.

### 1.13 Editing and deleting comments

- **Who:** a commenter may edit/delete **only their own** comment, and only when **logged in** — ownership is `comment.user_id === userInfo.objectId`. Anonymous (mail-only) comments can never be self-edited or self-deleted. Admins may edit/delete anything.
- **Edit:** the edit button swaps the card body for a prefilled `CommentBox` seeded from `orig` (the raw markdown, which the server only returns to the owner/admin). Saving calls `PUT /api/comment/:id`. On success the client mutates the local object in place rather than refetching.
- **Delete:** guarded by a native `confirm('Are you sure you want to delete this comment?')` — note this string is hardcoded English, **not** localized. Calls `DELETE /api/comment/:id`, then removes the item from the local array.
- Server-side delete cascades: `deleteAction` issues one delete with `_complex OR {objectId: id, pid: id, rid: id}` — so deleting a root comment **also deletes all its replies**, silently.
- Admin status/sticky changes are also made from the public comment area when logged in as admin (`onStatusChange` → `PUT` with `{status}`; `onSticky` → `PUT` with `{sticky: 0|1}`, root-only).

### 1.14 Login methods offered to commenters

Three axes: `login: 'enable' | 'disable' | 'force'` (client) combined with the server `LOGIN=force` env var.

- **Anonymous commenting** is the default posture: user fills nick/mail/link (`meta`, `requiredMeta`) and posts. Empty nick falls back to the locale `anonymous` string ("Anonymous"). `mail`, if provided, must be a valid email.
- **Account login** via a popup: `login()` in `@waline/api` opens `${serverURL}/ui/login?lng=<lang>` in a 1024×600 popup and waits for a `postMessage` of `{type: 'userInfo', data}`; on mobile it does a **full-page redirect** to the same URL with `redirect=<current href>` and the promise intentionally never resolves.
- **Provider list** (from the `wl_Users` table columns and the admin icon set): `github`, `twitter`, `facebook`, `google`, `weibo`, `qq`, `oidc`, `huawei`. Providers are not hardcoded client-side: the server proxies to an external OAuth broker (`OAUTH_URL`, default `https://oauth.lithub.cc`), fetches its service list via `middleware/fetch-oauth-service.js`, and exposes it to the admin UI as `window.oauthServices`.
- **Password login/registration** also exists, with email verification (see §2.4).
- **Token pickup:** the client checks for `?token=` in the page URL, calls `GET {serverURL}/token` with `Authorization: Bearer <token>`, stores `{...data, token}` and then **strips the token from the URL** via `history.replaceState`. Note the path here is `${serverURL}/token`, **not** `${serverURL}/api/token` — while every other call goes through `getFetchPrefix()` which inserts `/api/`. This looks like a bug in `main` at this commit (**unverified whether intentional**); flag it as an integration trap.
- User session is persisted in localStorage key `WALINE_USER` (whole `UserInfo` object including the JWT); `WALINE_USER_META` caches the nick/mail/link form values; `WALINE_COMMENT_BOX_EDITOR` persists an unsent draft.
- Profile editing opens `${serverURL}/ui/profile?lng=&token=` in a popup and syncs back via `postMessage({type:'profile'})`.
- Logout is client-side only (`userInfo.value = {}`); the server's `DELETE /api/token` is an empty no-op, so **JWTs cannot be revoked**.

### 1.15 i18n / locale support

- **13 locale bundles** in `packages/client/src/config/i18n/`: `de, en, es, fr, id, it, jp, ko-KR, pt-BR, ru, vi-VN, zh-CN, zh-TW`.
- Mapped to **23 language tags** in `DEFAULT_LOCALES`: `zh, zh-cn, zh-tw, en, en-us, fr, fr-fr, id, id-id, it, it-it, jp, jp-jp, ko, ko-kr, pt-br, ru, ru-ru, vi, vi-vn, de, es, es-mx`.
- Fallback chain: `getLang()` returns the input if known else `DEFAULT_LANG = 'en-US'`; `getLocale()` looks up case-insensitively. Matching is exact-tag only — there is **no region-to-base fallback** (i.e. `de-AT` falls back to English, not German).
- Locale key surface (`WalineLocale`): 41 static UI strings + 5 relative-time strings (`seconds, minutes, hours, days, now`) + 10 reaction strings (`reactionTitle`, `reaction0`–`reaction8`) + `level${number}` (open-ended, `level0`… default 6 supplied). Partial overrides via the `locale` option are shallow-merged.
- The docs' i18n page lists only 18 languages and omits `de, id, it` and their variants — the docs are stale relative to the code.
- Server has its own parallel locale set in `packages/server/src/locales/` (13 JSON files, 21 lookup keys in `locales/index.js`) used for API error messages and email subjects/bodies, selected by the `lang` query parameter.
- Admin has a third set of 13 JSON files with a `LANGUAGE_OPTIONS` list exposing 13 labels/aliases and a language switcher in the UI.
- i18n gaps are a live complaint ([#3836](https://github.com/walinejs/waline/issues/3836) "add missing i18ns").

### 1.16 Dark mode

`dark` option → `getDarkStyle()` emits a CSS block that redefines 12 custom properties:

`--waline-white, --waline-light-grey, --waline-dark-grey, --waline-color, --waline-bg-color, --waline-bg-color-light, --waline-bg-color-hover, --waline-border-color, --waline-disable-bg-color, --waline-disable-color, --waline-bq-color, --waline-info-bg-color, --waline-info-color`

- `dark: true` → `:root{…}`; `dark: 'auto'` → `@media(prefers-color-scheme:dark){body{…}}`; `dark: '<selector>'` → `<selector>{…}`.
- The block is injected with `useStyleTag(..., {id: 'waline-darkmode'})`, so exactly one style tag is managed per instance.
- Full theming is otherwise done by overriding the ~40 `--waline-*` CSS variables (documented in `reference/client/style.md`). v3 renamed `bgcolor` → `bg-color` etc.

### 1.17 Pageview counter

- `pageviewCount({serverURL, path, selector='.waline-pageview-count', update=true, lang})`, or `pageview: true` in `init()` to run it automatically (re-run on every `WalineInstance.update()`).
- Finds all matching elements; each element's own `data-path` (via `getQuery()`) overrides the default `path`, so one page can display counts for many articles.
- Elements whose `data-path` differs from the current path are read-only; the current path is **incremented** (`POST /api/article` with `type: 'time'`, `action: 'inc'`).
- Storage: the `time` column of the `Counter` table keyed by `url`. **No deduplication, no bot filtering, no session/UA logic** — every call increments. Counts are therefore trivially inflatable (documented as a deliberate fix vs Valine: at least the value is server-mediated, not client-writable).
- Returns an abort function (`WalineAbort`).

### 1.18 Comment-count element

- `commentCount({serverURL, path, selector='.waline-comment-count', lang})`, or `comment: true` in `init()`.
- Same `data-path` per-element override; `decodePath()` is applied.
- Backed by `GET /api/comment?type=count&url=a,b,c` which returns an **array of integers aligned to the requested order** (0 for unknown paths). Public (unauthenticated) counts exclude `waiting` and `spam`.
- Intended markup: `<span class="waline-comment-count" data-path="/foo/">`. The v3 migration removed support for reading `id`; `data-path` is now required.
- Returns an abort function.

### 1.19 Widgets

| Widget | Signature | Renders / returns |
| --- | --- | --- |
| `RecentComments` | `{el?, serverURL, count, lang?}` | `{comments: RecentCommentData[], destroy()}`. With `el`: injects a `<ul class="wl-recent-list">` of `<li class="wl-recent-item"><a href="{url}">{nick}</a>：{comment}</li>`. Built by raw `innerHTML` string concat (nick and rendered comment HTML are interpolated unescaped — the comment HTML is server-sanitised, but `nick` and `url` are not escaped here; **potential injection surface, unverified exploitability**). Sends the user token so logged-in users also see their own pending comments. |
| `UserList` | `{el?, serverURL, count, mode: 'list'\|'wall', lang?, locale?}` | `Promise<{users: WalineUser[], destroy()}>`. The widget option is `count` (as documented) and the implementation maps it to the API's `pageSize` (`getUserList({pageSize: count})`) — so `count` ≤ 50 for anonymous callers. Users are ranked by approved comment count and enriched with nick/link/avatar/label/level. With `el`: injects `<ul class="wl-user-{mode}">` items, also via raw `innerHTML` string concat with unescaped `user.nick`/`user.link`/`user.avatar` (**same injection surface as `RecentComments`; unverified exploitability**). |
| `Star` | `{el?, path, serverURL, lang?, onRate?}` | `{destroy()}`. See §1.12. |

Documentation bugs found (do not trust these doc statements): the `RecentComments` doc prose says the result property is `comment` (singular) but its own code sample and the implementation use `comments`; the server config doc names hooks `afterUpdate`/`afterDelete` while the code calls them `postUpdate`/`postDelete`.

### 1.20 Meta / SEO considerations

Verified findings:
- Comments are rendered **entirely client-side** by Vue into `v-html`; the server sends no HTML shell for the comment area. There is **no SSR, SSG, or hydration path** for comments.
- A grep of `packages/client/src` finds **no** `schema.org`, no `application/ld+json`, no Open Graph or `<meta>` emission. A new design wanting comment SEO would need to add server-rendered comment HTML or JSON-LD, which Waline does not do.
- The only structured, crawlable comment surface is **RSS**: `<link>`-less but user-visible links to `/api/comment/rss?path=…` (per-article) and `/api/comment/rss` (site-wide) in the footer (suppressed by `noRss`), plus a per-user replies feed `/api/comment/rss?user_id=…` in the card actions for the comment owner. `GET /api/comment/rss` accepts `path`, `email`, `user_id`, `count` (1–50, default 20) and returns RSS 2.0 XML with `Content-Type: application/rss+xml; charset=utf-8`; item links are `{SITE_URL}{comment.url}#{objectId}`.
- The `waline-meta.css` / `./meta` export is about the *comment metadata line* (addr/browser/os), **not** SEO meta tags — an easy naming misread.
- Comment HTML is sanitised server-side and links carry `rel="ugc nofollow noreferrer noopener"`, so outbound links from comments are explicitly non-authoritative for SEO.
- The **"Powered by Waline"** footer credit (`noCopyright`, default shown) and the `console.log` brand banner in the server's demo page are the only branding surfaces.
- `path` is the sole article identity. There is no canonical-URL normalisation beyond `decodePath()`; trailing slashes, query strings, and hash fragments in `window.location.pathname`-derived paths can therefore split one article's comments across multiple counters (**behaviour inferred from code; impact unverified**).

### 1.21 What the client does **not** have

No comment search UI, no @-mention autocomplete, no realtime/live updates or websockets, no presence indicators, no vote-up/down (only "like"), no report/flag button, no user blocking/muting, no notifications inbox for commenters, no subscribe-to-thread toggle in the UI, no numbered pagination, no sort-by-reply-count, no comment preview modal, no rich-text toolbar, no rate-limit feedback UI, no offline/draft-recovery UI beyond the persisted editor string, no a11y-complete markup (several interactive `<div>`s and `aria-hidden="true"` on meaningful content).

---

## 2. Server features — `@waline/vercel` (package `packages/server`)

### 2.1 Architecture and routing model

- Node.js HTTP server built on **ThinkJS 4** running as a serverless function. Entry: `packages/server/index.js` exports `main(configParams)` returning `(req, res) => …`; `vanilla.js` runs it as a normal server (`EXPOSE 8360` per the Dockerfile); `development.js` runs a watch-mode dev server on a port argument.
- Routing is **`think-router-rest`** convention-based, not a declarative route table. `src/config/router.js` is literally `module.exports = []`.
- The `router` middleware mounts with `options.prefix: ['/api', '<netlify-prefix>/api', '<netlify-prefix>']` — hence the `/api` prefix on every endpoint (added in 2023; the un-prefixed legacy routes were kept for compatibility with a deprecation warning, per `CHANGELOG.md`).
- Controller filename → resource; `<name>.js` at `src/controller/` handles `/<name>`, and `src/controller/<a>/<b>.js` handles `/<a>/<b>`. REST verbs map to `getAction/postAction/putAction/deleteAction`; `BaseRest.getId()` extracts the trailing path segment as the record id.
- **Admin UI is served by the server, not a separate app**: `middleware/dashboard.js` matches `/ui` and returns an HTML shell that sets `window.SITE_URL`, `window.SITE_NAME`, `window.recaptchaV3Key`, `window.turnstileKey`, `window.oauthServices`, `window.serverURL = '<serverURL>/api/'`, then loads `WALINE_ADMIN_MODULE_ASSET_URL` (default `//unpkg.com/@waline/admin`). Admin routes: `/ui/login`, `/ui/register`, `/ui/forgot`, `/ui/profile`, `/ui/manage-comments`, `/ui/user`, `/ui/migration`.
- Body limit: `payload` middleware `limit: '5mb'`, `keepExtensions: true`.
- CORS via `@koa/cors` with default permissive settings.
- Also present: `middleware/version.js` (version header), `middleware/prefix-warning.js` (legacy-route deprecation), `middleware/plugin.js` (runs plugin Koa middlewares), `middleware/fetch-oauth-service.js` (fetches the OAuth broker's service list on every request; 502 if the broker is down — **a hard external dependency in the request path**).
- `/` (the `indexAction` of `controller/index.js`) returns a demo HTML page that boots a client from unpkg.

### 2.2 Complete REST API endpoint list

Auth column: `—` public, `T` any valid JWT, `A` administrator JWT.

| # | Method | Path | Query / body | Auth | Response |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/api/comment` | `path` (required unless `type` given), `page` (≥1, def 1), `pageSize` (1–100, def 10), `sortBy` ∈ {`insertedAt_desc`,`insertedAt_asc`,`like_desc`} (def `insertedAt_desc`), `lang` | — (T unlocks own `waiting`/`spam`) | `{errno,errmsg,data:{page,totalPages,pageSize,count,data:[RootComment]}}` |
| 2 | GET | `/api/comment?type=count` | `url` (comma-separated paths; empty ⇒ site total), `lang` | — | `data` = `number` (site total) or `number[]` aligned to `url` order |
| 3 | GET | `/api/comment?type=recent` | `count` (1–50, def 10), `lang` | — (T includes own pending) | `data` = flat `Comment[]` including `url` |
| 4 | GET | `/api/comment?type=list` | `page` (def 1), `pageSize` (1–100, def 10), `owner` ∈ {`all`,`mine`}, `status` ∈ {`approved`,`waiting`,`spam`}, `keyword`, `lang` | **A** (`logic/comment.js` `checkAdmin()`) | `data = {page, totalPages, pageSize, spamCount, waitingCount, data:[Comment]}` |
| 5 | POST | `/api/comment` | body `NewComment`: `url`★, `comment`★, `nick`, `mail`, `link`, `ua`, `pid`, `rid`, `at`, `recaptchaV3`, `turnstile`; `lang` | — (T allowed; `LOGIN=force` ⇒ 401 without T) | `{errno,errmsg,data:Comment}` (the newly created comment, rendered) |
| 6 | PUT | `/api/comment/:id` | body `CommentUpdate`: `nick, mail, link, comment, url, like (bool), status, sticky (0\|1)`; `lang` | `{like}` only ⇒ —; else T + (owner or A) | `{errno,errmsg,data:Comment}` |
| 7 | DELETE | `/api/comment/:id` | `lang` | T + (owner **or** A) | `{errno,errmsg,data:''}`; cascades to `pid`/`rid` children |
| 8 | GET | `/api/comment/rss` | `path`, `email`, `user_id`, `count` (1–50, def 20) | — (whitelisted from `referrerCheck`) | `application/rss+xml` |
| 9 | GET | `/api/article` | `path` (array — comma-separated; the client sends `paths.join(',')`), `type` (array, **default `['time']`**; client sends `type.join(',')`), `lang` | — | `data` = array of `{ [type]: number }` aligned to `path`; returns `0` when `path` is missing |
| 10 | POST | `/api/article` | body `{path ★string, type ★string (default `'time'`), action ∈ {`inc`,`desc`} default `inc`}`, `lang` | — | `data` = `[{ [type]: number }]` |
| 11 | GET | `/api/token` | `lang` | — / T | current user object, `{}` when unauthenticated |
| 12 | POST | `/api/token` | body `{email★, password★, code?, recaptchaV3?, turnstile?}`, `lang` | — | `data = {...user, password:null, token: <JWT>}` |
| 13 | DELETE | `/api/token` | `lang` | — | `{}` — **no-op; does not invalidate the JWT** |
| 14 | GET | `/api/token/2fa` | `email?`, `lang` | — with `email` ⇒ `{enable: bool}`; T without ⇒ `{otpauth_url, secret}` | |
| 15 | POST | `/api/token/2fa` | body `{secret, code}` | T | `{}` on success, `fail` on bad TOTP |
| 16 | GET | `/api/user` | `page` (def 1), `pageSize` (public ≤50 def 20; admin ≤100 def 10), `email` (admin-only), `lang` | — / A | public ⇒ `WalineUser[]` ranking (`{nick, link, avatar, label, level?, count}`); admin ⇒ `{page,totalPages,pageSize,data:Users[]}`; admin+`email` ⇒ single user |
| 17 | POST | `/api/user` | body `{display_name★, email★, password★, url?, recaptchaV3?, turnstile?}`, `lang` | — | `{}` or `{verify: true}` when email verification was sent. First-ever user becomes `administrator`. |
| 18 | PUT | `/api/user` | body `{display_name, url, avatar, password, type, label, email, '2fa', <social>}` — `type`/`label`/other-user edits require A | T | `{}` |
| 19 | DELETE | `/api/user/:id` | `lang` | A, cannot target self | `{}`; deletes unverified accounts, otherwise sets `type='banned'` (soft ban) |
| 20 | PUT | `/api/user/password` | body `{email}` | — | `{}`; emails a password-reset magic link. Fails if no SMTP configured. |
| 21 | GET | `/api/verification` | `token`, `email` | — | 302 redirect to `/ui/login` on success; `fail` otherwise. Token = 4-digit code, 1-hour expiry. |
| 22 | GET | `/api/oauth` | `type`, `redirect`, `code?`, `state?` | — | 302 to `/ui/profile` or to `redirect?token=<JWT>`, or `fail` |
| 23 | GET | `/api/db` | `lang` | A | `{type:'waline', version:1, time, tables:['Comment','Counter','Users'], data:{Comment:[],Counter:[],Users:[]}}` — full dump |
| 24 | POST | `/api/db` | `table` ∈ {Comment,Counter,Users}; body = row | A | created row (import; `objectId` dropped, dates coerced per driver) |
| 25 | PUT | `/api/db` | `table`, `objectId`; body = patch | A | `{}` |
| 26 | DELETE | `/api/db` | `table` | A | `{}` — **deletes every row of the table** |

★ = required.

**Endpoints the brief assumed that do NOT exist** (verified by exhaustive grep over `packages/server/src`): `/api/upload`, `/api/reaction`, `/api/config`, `/api/notify`. Image upload is client-side only (§1.9); reactions are a `Counter` column updated through `/api/article` (§1.11); there is no runtime config endpoint — all configuration is env vars at deploy time plus the `index.js` object (§2.9); notifications have no API, they fire inside `POST /api/comment` and `PUT /api/comment/:id` (§2.6).

Also note the OpenAPI file at `packages/server/openapi.yaml` (**the best single machine-readable reference**) documents only paths 1–7, 11–13, 16–19, 22, 23–26 — it **omits** `/api/article`, `/api/token/2fa`, `/api/user/password`, and `/api/verification`.

### 2.3 Response envelope and error model

- Success: `this.success(data)` → `{errno: 0, errmsg: '', data}`.
- Failure: `this.fail(msg)` → non-zero `errno` with a human message, localised through the server locale files using the `lang` query parameter.
- HTTP status codes carry meaning too: `401` (no/invalid token where required — set via `ctx.throw` in the logic layer), `403` (authenticated but not permitted; also used for failed captcha, disallowed IP, and blocked referrer), `400` (bad params / bad RSS query), `502` (OAuth broker unreachable).
- The client's `errorCheck()` throws a `TypeError` when `errno` is truthy, so anything non-zero is a hard error client-side.

### 2.4 Authentication model

**Commenter / end-user auth — there is no passwordless "magic link login".** The real flow is:
1. `POST /api/user` with `display_name`, `email`, `password`. Password is hashed with `phpass`.
2. If **no** mail service is configured (`SMTP_HOST`/`SMTP_SERVICE` both unset), `type` is set to `'guest'` immediately.
3. If a mail service **is** configured, `type` is set to the literal string `verify:<4-digit-code>:<timestamp+1h>` and a confirmation email is sent containing `GET {serverURL}/verification?token=<code>&email=<email>`. Clicking it flips `type` to `'guest'` — this is an **email-confirmation magic link**, not a login link. Purpose is anti-mass-registration.
4. The **first user ever created** gets `type: 'administrator'` — a bootstrap-by-first-registration model.
5. `POST /api/token` with `email` + `password` (+ `code` for TOTP) returns `{...user, password: null, token: jwt.sign(objectId, jwtKey)}`. `verify:*` and `banned` accounts are rejected.
6. Password **reset** *is* a magic link: `PUT /api/user/password` emails `${serverURL}/ui/profile?token=<JWT>` — and that JWT is signed **without an expiry claim** (**unverified whether deliberate**; the registration code, by contrast, does have a 1-hour expiry).
7. **2FA**: TOTP (`speakeasy`, `window: 2`) stored base32 in the `2fa` column (32 chars). Enrollment: `GET /api/token/2fa` → `{otpauth_url: 'otpauth://totp/waline_<objectId>?secret=…', secret}`; activation: `POST /api/token/2fa` with `{secret, code}`. Login then requires `code`. There is no recovery-code mechanism. `GET /api/token/2fa?email=` lets the login page detect whether a given account has 2FA enabled — **account enumeration by design**.
8. **OAuth**: `GET /api/oauth?type=<provider>&redirect=<url>` redirects to `{OAUTH_URL}/{type}?redirect=…&state=…`; the broker calls back with `code`; the server fetches `{OAUTH_URL}/{type}?code&state` and receives `{id, name, email, avatar, url}`. If a user already has that `<provider>` id, it signs a JWT for that account. If the caller is logged in, it **links** the provider id to their account. Otherwise it **creates** a new account (`type: 'guest'`, or `administrator` if the Users table is empty) and redirects with `?token=<JWT>`.
   - A known consequence: social logins synthesise placeholder emails at the broker's domain, and notifications to those addresses are suppressed by a `fakeMail` regex built from `mail.<provider>` (`service/notify.js`); issue [#3359](https://github.com/walinejs/waline/issues/3359) reports users not receiving reply notifications after social login.
9. **Token transport**: `Authorization: Bearer <JWT>` **or** a `state` query parameter (used for the OAuth handshake). JWT payload is just the user `objectId`; key is `jwtKey`, derived from `JWT_TOKEN` or, if absent, **silently reused from the storage credential** (e.g. `LEAN_KEY`, `MONGO_PASSWORD`, `PG_PASSWORD`, `MYSQL_PASSWORD`, `GITHUB_TOKEN`, `TCB_ENV`). No expiry, no revocation list, no refresh. Tokens are stored in `localStorage` client-side, so they are readable by any XSS.

**Admin auth** is the same JWT plus `type === 'administrator'`. Two enforcement layers:
- `logic/base.js __before()` verifies the JWT and loads `ctx.state.userInfo` (excluding `banned`).
- `logic/comment.js checkAdmin()` → 401 if unauthenticated, 403 if not administrator.
- Per-route logic guards: `logic/db.js` requires A for all verbs; `logic/user.js` requires A for `page`/`email`/other-user edits/deletes and forbids self-delete; `logic/comment.js` `putAction`/`deleteAction` implement owner-or-admin; `logic/token.js` requires `email`+`password`.
- The admin SPA keeps its token in `window.TOKEN` + `sessionStorage`/`localStorage` under key `TOKEN` (`services/auth.js`).

### 2.5 Rate limiting and anti-spam

| Mechanism | Where | Behaviour |
| --- | --- | --- |
| **IP frequency limit** | `controller/comment.js` `postAction` | `IPQPS` env (default **60 s**). Queries for any comment with the same `ip` inserted within the window; if found → `fail('Comment too fast!')`. **One comment per IP per 60 s globally, across all articles.** Admins bypass it. Note this is a read-then-write race and is not a distributed rate limiter; a legacy bug report claims IPQPS was ineffective ([#482](https://github.com/walinejs/waline/issues/482)). |
| **IP disallow list** | same | `disallowIPList` (server `index.js` config only — **there is no env var**; `config.js` hardcodes `disallowIPList: []`). Exact-match `includes(ip)` → HTTP 403. Admins bypass. |
| **Duplicate-content check** | same | Exact match on `{url, mail, nick, link, comment}` → `fail('Duplicate Content')`. Strict equality, so trivial whitespace variation defeats it. |
| **Forbidden words** | same | `FORBIDDEN_WORDS` (comma-separated) or `forbiddenWords` config → `new RegExp('(w1|w2)', 'igu')` tested against the raw comment; match ⇒ `status = 'spam'`. The word list is interpolated into a regex **unescaped**, so regex metacharacters in a keyword change matcher semantics (**unverified whether this is exploited in practice, but it is a real correctness hazard**). |
| **Akismet** | `service/akismet.js` | `AKISMET_KEY`; **defaults to the shared demo key `70542d86693e`** — i.e. spam checking is ON by default with someone else's key. `AKISMET_KEY=false` disables. Only runs when the comment would otherwise be `approved` (i.e. skipped when `COMMENT_AUDIT` is on). Akismet errors are swallowed (`catch → console.log`) so a failed check never blocks a comment. Sends `user_ip`, `permalink` (`SITE_URL + url`), `comment_author`, `comment_content`. |
| **Comment audit / pre-moderation** | `COMMENT_AUDIT` | When truthy, every new non-admin comment starts as `waiting` instead of `approved`, and Akismet is skipped. |
| **reCAPTCHA v3** | `logic/base.js useCaptchaCheck()` | `RECAPTCHA_V3_KEY` (client) + `RECAPTCHA_V3_SECRET` (server). Verified at `https://recaptcha.net/recaptcha/api/siteverify` via GET. Applied to `POST /api/comment` (only when not logged in and `LOGIN !== 'force'`), `POST /api/user`, and `POST /api/token` (login). |
| **Cloudflare Turnstile** | same | `TURNSTILE_KEY` + `TURNSTILE_SECRET`. **Turnstile takes precedence over reCAPTCHA** if both secrets are set. Verified at `https://challenges.cloudflare.com/turnstile/v0/siteverify` via POST. |
| **Referrer / origin allow-list** | `logic/base.js referrerCheck()` | `SECURE_DOMAINS` (comma-separated) or `secureDomains` config; supports exact strings, `/regex/` strings, and arrays. Compares `ctx.referrer(true)` else `ctx.origin` hostname. `localhost` and `127.0.0.1` are always appended, as are the OAuth broker origins. `/api/comment/rss` and the OAuth callback are whitelisted. Caution: if there is **no** `Referer` and **no** `Origin` header, `checking` is falsy and `some()` returns false ⇒ 403 (unless `secureDomains` is unset, in which case the check passes entirely). |
| **XSS** | `service/markdown/xss.js` | DOMPurify with `FORBID_TAGS: form, input, style`, `FORBID_ATTR: autoplay, style`, link-target/rel hooks, `preload=none`. Open request for "avoid any vulnerabilities" ([#3555](https://github.com/walinejs/waline/issues/3555)). |
| **Forced login** | `LOGIN=force` | `POST /api/comment` throws 401 for unauthenticated callers. Must be paired with the client `login: 'force'`. |

There is **no** CSRF token mechanism, **no** per-user rate limit, **no** distributed/atomic rate limiter, **no** shadow-ban, and **no** reputation scoring. Shadow banning and anonymous-account management are open requests ([#2879](https://github.com/walinejs/waline/issues/2879)). Additional captcha providers are an open request ([#3441](https://github.com/walinejs/waline/issues/3441)).

### 2.6 Notification integrations

Implemented in `service/notify.js`. **All notifications are fire-and-forget inside the request handler and are awaited serially** — the docs' FAQ explicitly blames this for slow comment posting ("spam detection and comment notification are all serial operations").

Trigger rules (`run(comment, parent, disableAuthorNotify)`):
- **Author/blogger notification** (mail + every configured IM channel) is sent when the new comment is *not* by an administrator and `DISABLE_AUTHOR_NOTIFY` is unset, to `AUTHOR_EMAIL`.
- The mail fallback to `AUTHOR_EMAIL` is used **only if every IM channel returned empty** (`wechat, qq, telegram, qywxAmWechat, pushplus, discord, lark` all empty).
- **Reply notification to the parent comment's author** is sent when there is a parent, the parent's mail is not a synthetic social-login address, the replier is not the parent author, the parent is not an admin, and the comment is not `waiting`. Sent on approval too: when `PUT` flips `waiting → approved` on a reply, the notification is (re)sent with `disableAuthorNotify = true`.
- Commenters cannot opt out and there is no unsubscribe link; no notification preferences exist.

| Channel | Required env vars | Optional env vars | Transport |
| --- | --- | --- | --- |
| **Email** | `SMTP_HOST` (or `SMTP_SERVICE`), `SMTP_USER`, `SMTP_PASS`, `SITE_NAME`, `SITE_URL` | `SMTP_PORT`, `SMTP_SECURE`, `SENDER_NAME`, `SENDER_EMAIL`, `AUTHOR_EMAIL`, `MAIL_SUBJECT`, `MAIL_TEMPLATE`, `MAIL_SUBJECT_ADMIN`, `MAIL_TEMPLATE_ADMIN` | nodemailer; `SMTP_SERVICE` wins over host/port |
| **WeChat (Server酱)** | `SC_KEY` | `SC_TEMPLATE` | POST `https://sctapi.ftqq.com/{SC_KEY}.send` (form: `text`, `desp`) |
| **WeCom / 企业微信 app** | `QYWX_AM` (5 comma-separated parts: corpid, corpsecret, touser, agentid, thumb_media_id) | `QYWX_PROXY`, `QYWX_PROXY_PORT`, `WX_TEMPLATE` | gettoken + `cgi-bin/message/send` as `mpnews` |
| **QQ (Qmsg)** | `QMSG_KEY`, `QQ_ID` | `QMSG_HOST` (default `https://qmsg.zendee.cn`), `QQ_TEMPLATE` | POST `{host}/send/{QMSG_KEY}` |
| **Telegram** | `TG_BOT_TOKEN`, `TG_CHAT_ID` | `TG_TEMPLATE` | Bot API `sendMessage`, `parse_mode: MarkdownV2` |
| **PushPlus** | `PUSH_PLUS_KEY` | `PUSH_PLUS_TOPIC`, `PUSH_PLUS_TEMPLATE`, `PUSH_PLUS_CHANNEL`, `PUSH_PLUS_WEBHOOK`, `PUSH_PLUS_CALLBACKURL` | POST `http://www.pushplus.plus/send/{KEY}` |
| **Discord** | `DISCORD_WEBHOOK` | `DISCORD_TEMPLATE` | POST webhook JSON `{content}` |
| **Lark / Feishu** | `LARK_WEBHOOK` | `LARK_SECRET` (HMAC-SHA256 request signing), `LARK_TEMPLATE` | POST webhook `msg_type: post` |
| **Generic webhook** | `WEBHOOK` | — | `ctx.webhook(type, data)` in `extend.js`; POSTs `{type, data}` with `type = 'new_comment'`, fired on comment creation. Fires regardless of status (including spam). |

Template variables documented in `docs/src/en/guide/features/notification.md`: `site.name`, `site.url`, `site.postUrl`, `self.nick`, `self.mail`, `self.comment`, `self.url`, `self.status`, `self.objectId`, `parent.*` (plus `self.commentLink`, `postName` for Telegram/WeCom). Templates are rendered with **nunjucks** (`|safe` filter supported). Channel-specific config keys also exist on the `index.js` object: `QQTemplate`, `TGTemplate`, `WXTemplate`, `SCTemplate`, `DiscordTemplate`, `LarkTemplate` — note `SCTemplate`/`DiscordTemplate`/`LarkTemplate` are read from `think.config()` only, while `QQ/TG/WX` are exposed via env.

Missing/broken notification behaviour reported by users: no per-commenter notification centre ([#2553](https://github.com/walinejs/waline/issues/2553)), Discord multipart content issues ([#3770](https://github.com/walinejs/waline/issues/3770)), Telegram failures ([#2280](https://github.com/walinejs/waline/issues/2280), [#3350](https://github.com/walinejs/waline/issues/3350)), blogger-not-notified bugs ([#2143](https://github.com/walinejs/waline/issues/2143)), social-login email suppression ([#3359](https://github.com/walinejs/waline/issues/3359)). Requested additions: Bark ([#2634](https://github.com/walinejs/waline/issues/2634)), WeCom group bot ([#2661](https://github.com/walinejs/waline/issues/2661)), Office365 OAuth2 SMTP ([#2878](https://github.com/walinejs/waline/issues/2878)).

### 2.7 Storage / database adapters

Selected implicitly by which credential env vars are present, in a fixed priority order (`config/config.js`) — **the first match wins, silently**:

`LEAN_KEY` → `leancloud` · `MONGO_DB` → `mongodb` · `PG_DB`/`POSTGRES_DATABASE` → `postgresql` · `SQLITE_PATH` → `sqlite` · `MYSQL_DB` → `mysql` · `TIDB_DB` → `tidb` · `GITHUB_TOKEN` → `github` · (`think.env === 'cloudbase'` or `TCB_ENV`) → `cloudbase`. If none matches, the process **throws at startup**: `"No valid storage found. Please check your environment variables."` SQLite on CloudBase throws explicitly.

Driver wiring is in `config/adapter.js` (`think-model`, `think-mongo`, `think-model-mysql`, `think-model-mysql2`, `think-model-postgresql`, `think-model-sqlite`). Table prefix defaults to `wl_` for SQL backends (`MYSQL_PREFIX`, `TIDB_PREFIX`, `SQLITE_PREFIX`, `PG_PREFIX`/`POSTGRES_PREFIX`). Mongo supports multi-host JSON-array `MONGO_HOST`/`MONGO_PORT`, `MONGO_REPLICASET`, `MONGO_AUTHSOURCE`, and arbitrary pass-through options via `MONGO_OPT_*` (underscores converted to camelCase). Postgres/TiDB have `connectionLimit: 1` — a notable serverless choice.

Adapters present in `packages/server/src/service/storage/`: `base.js` (abstract `select/count/add/update/delete`), `leancloud.js`, `mongodb.js`, `mysql.js`, `postgresql.js`, `sqlite.js`, `tidb.js`, `github.js`, `cloudbase.js`. A custom storage class can be supplied via the `model` config key (aliased internally to `customModel`, see issue #2649).

GitHub-as-storage uses `GITHUB_TOKEN` + `GITHUB_REPO` + optional `GITHUB_PATH`, i.e. commits data into a repo. SQL backends require **manual schema import** from `assets/waline.sql`, `assets/waline.pgsql`, `assets/waline.tidb`, or `assets/waline.sqlite.sql` — there is no migration framework and no auto-migration.

### 2.8 Environment-variable configuration model (complete)

Configuration is **entirely deploy-time env vars** (plus the optional `index.js` object, §2.9). There is no config file, no DB-stored settings, and no admin-editable settings UI. The docs warn: **you MUST redeploy after changing env vars**.

**Basic / identity:** `SITE_NAME`, `SITE_URL`, `SERVER_URL` (override the auto-derived server address), `LOGIN` (`force` to require login server-side), `WEBHOOK`.

**Display / privacy:** `DISABLE_USERAGENT` (omit browser/os), `DISABLE_REGION` (omit addr), `AVATAR_PROXY` (default documented as `https://avatar.75cdn.workers.dev`; set `false` to disable; wraps avatar URLs as `{proxy}?url=<encoded>` — an SSRF-ish proxy dependency), `GRAVATAR_STR` (nunjucks template; default handles QQ numbers, `@qq.com` mails, else libravatar MD5), `LEVELS` (comma-separated ascending thresholds → `levelN` badges; e.g. `0,10,20,50,100,200`; `false` disables), `DISABLE_AUTHOR_NOTIFY`, `AUTHOR_EMAIL`.

**Safety:** `IPQPS` (default 60), `SECURE_DOMAINS`, `AKISMET_KEY` (default `70542d86693e`; `false` to disable), `COMMENT_AUDIT` (default false), `RECAPTCHA_V3_KEY`, `RECAPTCHA_V3_SECRET`, `TURNSTILE_KEY`, `TURNSTILE_SECRET`, `FORBIDDEN_WORDS`, `LIKE_INC_MAX` (like increment randomness, default 1 — **undocumented**). Note `FORBIDDEN_WORDS` and `LIKE_INC_MAX` are **not** in the env reference doc.

**Markdown:** `MARKDOWN_CONFIG` (JSON, passed to markdown-it), `MARKDOWN_HIGHLIGHT` (default true), `MARKDOWN_EMOJI` (true), `MARKDOWN_SUB` (true), `MARKDOWN_SUP` (true), `MARKDOWN_TEX` (`mathjax` default | `katex` | `false`), `MARKDOWN_MATHJAX` (JSON), `MARKDOWN_KATEX` (JSON).

**Mail:** `SMTP_SERVICE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SENDER_NAME`, `SENDER_EMAIL`.

**Storage (Mongo):** `MONGO_DB`★, `MONGO_USER`★, `MONGO_PASSWORD`★, `MONGO_HOST` (def 127.0.0.1), `MONGO_PORT` (def 27017), `MONGO_REPLICASET`, `MONGO_AUTHSOURCE`, `MONGO_OPT_*`.
**MySQL:** `MYSQL_DB`★, `MYSQL_USER`★, `MYSQL_PASSWORD`★, `MYSQL_HOST`, `MYSQL_PORT` (3306), `MYSQL_PREFIX` (`wl_`), `MYSQL_CHARSET` (`utf8mb4`), `MYSQL_SSL`.
**TiDB:** `TIDB_DB`★, `TIDB_USER`★, `TIDB_PASSWORD`★, `TIDB_HOST`, `TIDB_PORT` (4000), `TIDB_PREFIX`, `TIDB_CHARSET`.
**SQLite:** `SQLITE_PATH`★, `SQLITE_DB` (`waline`), `SQLITE_PREFIX`, plus `JWT_TOKEN` recommended.
**PostgreSQL:** `PG_DB`★ (alias `POSTGRES_DATABASE`), `PG_USER`★ (`POSTGRES_USER`), `PG_PASSWORD`★ (`POSTGRES_PASSWORD`), `PG_HOST` (`POSTGRES_HOST`), `PG_PORT` (`POSTGRES_PORT`, doc says 3211), `PG_PREFIX` (`POSTGRES_PREFIX`, `wl_`), `PG_SSL` (`POSTGRES_SSL`), `POSTGRES_URL` (`sslmode=require` triggers SSL).
**GitHub:** `GITHUB_TOKEN`★, `GITHUB_REPO`★ (e.g. `walinejs/waline`), `GITHUB_PATH`.
**CloudBase:** `TCB_ENV`, `TENCENTCLOUD_SECRETKEY`, `TCB_KEY`.
**Auth/security:** `JWT_TOKEN` (signing key; **falls back to a storage credential if unset**).
**Advanced:** `OAUTH_URL` (default `https://oauth.lithub.cc`), `WALINE_ADMIN_MODULE_ASSET_URL` (default `//unpkg.com/@waline/admin`), `IP2REGION_DB` (deprecated), `IP2REGION_DB_V4`, `IP2REGION_DB_V6` (setting the v6 one enables IPv6 geolocation).

**Notification vars:** the full list is in §2.6.

### 2.9 Server `index.js` configuration object and hooks

Beyond env vars, a deploy can pass an object to `Waline({...})` (`packages/server/index.js` maps each key into `think.config`). Keys: `plugins`, `secureDomains`, `forbiddenWords`, `disallowIPList`, `mailSubject`, `mailTemplate`, `mailSubjectAdmin`, `mailTemplateAdmin`, `QQTemplate`, `TGTemplate`, `WXTemplate`, `SCTemplate`, `DiscordTemplate`, `LarkTemplate`, `model` (custom storage class), `encryptPassword` (custom password hashing), `locales` (custom server locale strings), `avatarUrl` (function `(comment) => string`), `domPurify` (DOMPurify options), `markdown`, and `env`.

**Comment lifecycle hooks** (also expressible as plugin `hooks`): `preSave(comment)` (return `{errmsg}` to reject), `postSave(comment, parentComment)`, `preUpdate(comment)` (return a value to abort), `postUpdate(comment)`, `preDelete(commentId)`, `postDelete(commentId)`. Hook resolution is `controller/rest.js hook(name, ...args)` — the config function runs first, then plugin hooks in install order; the first truthy return short-circuits.

Docs list `afterUpdate`/`afterDelete` in prose but the code names them `postUpdate`/`postDelete` — **documentation inconsistency**.

### 2.10 Plugin system

`Waline({plugins: [...]})`. A plugin is `{hooks: {...}}` and/or `{middlewares: [koaMiddleware]}`. Koa middlewares are composed via `koa-compose` in `middleware/plugin.js` and run before the controller layer; each **must** `await next()`. Official plugins listed in the docs: `@waline-plugins/hello-world`, `@waline-plugins/privacy`, `@waline-plugins/tencent-tms`, `@waline-plugins/link-interceptor`.

### 2.11 Other server-side behaviour

- **Geolocation**: `think.ip2region(ip, {depth})` from `ip2region`; admins get depth 3 (more precise), non-admins depth 1; suppressed by `DISABLE_REGION`.
- **UA parsing**: `ua-parser-js`, reduced to `browser.name + first 2 version parts` and `os.name + os.version`; suppressed by `DISABLE_USERAGENT`.
- **Email exposure**: `formatCmt()` sets `comment.mail = md5(mail)` for non-admin responses and deletes the raw address; admins receive the real value. IP is only attached for admins. `comment.orig` (raw markdown) is attached **only when a login user is present**.
- **Level computation** happens on read: a grouped `count` over approved comments keyed by `user_id`/`mail`, then `think.getLevel(count)` against the `LEVELS` array.
- **Comment count semantics**: `count` in the public list response counts **all** comments (roots + replies) for the path, while `totalPages` uses only roots — so the count shown in the header and the number of pages are computed from different denominators.
- The `insertedAt` field is **deleted** from responses unless `ctx.state.deprecated` (legacy route); clients get `time` (epoch ms) instead. `createdAt`/`updatedAt` are always deleted.
- No caching layer, no queue, no background jobs, no scheduled tasks, no observability beyond `think-logger3` console logging. `workers: 1`.

---

## 3. Moderation and admin console — `@waline/admin`

React + Redux + react-i18next + react-i18next-browser-languagedetector SPA, styled on top of a Typecho-derived CSS framework (`typecho-*` classes). Shipped as a **single bundled script** loaded from unpkg by the server's `/ui` shell (`WALINE_ADMIN_MODULE_ASSET_URL`). Version `0.34.2`. Pages: Login, Register, Forgot, Profile, Manage Comments, Users, Migration.

### 3.1 Comment list filters

From `pages/manage-comments/index.jsx`:
- **Owner**: `all` | `mine` (server-side `owner=mine` filters on `where.mail = userInfo.email`, i.e. *the admin's own email*, not the comment's `user_id`).
- **Status**: `approved` (default) | `waiting` | `spam`. `waiting` and `spam` tabs show a **count balloon** (`waitingCount`, `spamCount` returned by the server).
- **Keyword**: a single text input passed as `keyword`, which the server applies as `comment LIKE '%keyword%'` **against the rendered HTML** — so it matches markup and emoji `<img>` tags as readily as prose, and cannot match the original markdown. There is **no** filter by article path, by user, by IP, by date range, by browser/OS, or by `has-replies`.
- Pagination is a `Paginator` component; page size is fixed at the server default (10) — the admin does not send `pageSize`.
- Server-side ordering is always `insertedAt DESC`. There is **no sorting control** in the console and no way to view thread structure (replies appear as flat rows; `pid`/`rid` are not surfaced as a tree).

### 3.2 Per-comment actions

| Action | Show condition | Behaviour |
| --- | --- | --- |
| Approve | always | `PUT /api/comment/:id {status:'approved'}`; row removed from the current filtered list |
| Waiting (un-approve) | always | `PUT {status:'waiting'}` |
| Spam | always (label "mark as spam" in bulk mode) | `PUT {status:'spam'}` |
| Sticky / Disable sticky | root comments (`!comment.rid`) with `status === 'approved'` | `PUT {sticky: 1|0}` |
| Edit | always | inline form; `PUT` with the edited fields |
| Reply as admin | only when `status === 'approved'` | `POST /api/comment` with `{nick: admin display_name, mail: admin email, link: admin url, ua: navigator.userAgent, url, comment, pid, rid: rid ?? pid, at}` then **`location.reload()`** — a full page reload to show the reply |
| Delete | always | `confirm('delete one confirm', {nick})` → `DELETE /api/comment/:id` |

### 3.3 Bulk actions

A select-all checkbox plus per-row checkboxes feed `commentIds`. The dropdown then offers **Approved / Waiting / Spam / Delete** as multi-record operations, implemented as `Promise.all(ids.map(...))` — **no batching, no progress UI, no partial-failure handling**, and for status changes it refetches the list afterwards. There is **no** bulk move-between-articles, no bulk label, and no bulk export-of-selection.

### 3.4 User management (`/ui/user`)

- Paginated user list (`GET /api/user?page=N`) with avatar, name, email, role, exclusive label.
- Per-user actions: **set administrator**, **set guest** (blocked for yourself, with an alert `"You can't set yourself to be guest!"`), **set label** (a `prompt()` for the text — stored in the `label` field and rendered as a badge next to the nick), **delete** (soft-ban unless the account is still `verify:*`, in which case it is hard-deleted). `type: 'banned'` users cannot log in.
- Roles displayed: `administrator`, `guest`, and `verify*` shown as an "unverified" state.
- There is **no** user detail view, no per-user comment drill-down, no IP-ban action, no password reset from the console, and no way to view a user's comment history.

### 3.5 Profile / self-service admin settings (`/ui/profile`)

Edit `display_name`, `email`, `url`, exclusive `label`, `avatar` (via a `prompt()` for an image URL — **no file upload**), change `password` (with confirm), connect/disconnect **social accounts** (rendered from `window.oauthServices` using the admin's own icon set for facebook/github/google/huawei/oidc/qq/twitter/weibo), and enable/disable **2FA** (`pages/profile/twoFactorAuth.jsx`: shows the `otpauth_url`/secret and verifies a code). A `?token=` query param pre-authenticates the page, which is how the password-reset magic link works.

### 3.6 Configuration editing, dashboard stats, export

- **There is no configuration-editing UI.** All server settings are env vars requiring redeploy (§2.8). This is a significant gap versus what "admin console" usually implies.
- **Dashboard stats are minimal**: the comment list header is the only "dashboard" — `waitingCount` and `spamCount` balloons plus the filtered total. There is no time-series chart, no counts-by-article table, no user growth, no pageview dashboard, no Akismet verdict display.
- **Export / import** (`/ui/migration`): **Export** calls `GET /api/db` and downloads the whole database as a pretty-printed JSON file named `waline.json` (`application/javascript` MIME) with shape `{type:'waline', version:1, time, tables:['Comment','Counter','Users'], data:{...}}`. **Import** reads a JSON file, asks for confirmation ("import clear data confirm"), **truncates each non-Users table** (`DELETE /api/db?table=…`), then re-inserts rows one-by-one with progress `importing {{n}}/{{m}}`, maintains an `idMaps` translation for `objectId`, then does a second pass to remap relational ids (`Comment.pid`, `Comment.rid`, `Users.user_id`) and finally `PUT`s the patched rows. Users are matched by existing `objectId` and updated rather than duplicated, and imported comments without a status default to `approved`.
  - Practical limits: O(n) HTTP requests, no transaction, no rollback, aborts mid-way leave partial data, and ids are remapped only for `Comment`/`Users` relations. Issue [#1747](https://github.com/walinejs/waline/issues/1747) reports `NOT NULL constraint failed` on import; [#3488](https://github.com/walinejs/waline/issues/3488) reports the Artalk migration producing invalid JSON. There is **no CSV/XML export** and no per-article export.
- A separate **data migration assistant** exists in the docs site (`docs/src/.vuepress/components/MigrationTool.vue` plus `docs/src/.vuepress/utils/transform/*.ts`: `artalk2lc.ts`, `commento2lc.ts`, `disqus2lc.ts`, `tk2lc.ts` (Twikoo), `lc2csv.ts`, `lc2tcb.ts`) — these convert **into LeanCloud format**, i.e. they are documentation-site tools, not server features, and are aimed at importing *into LeanCloud storage*.
- Admin UI localStorage/sessionStorage token key: `TOKEN`; also sets `window.TOKEN`.
- Admin i18n: 13 locale JSONs and a language switcher with 13 `LANGUAGE_OPTIONS`.

---

## 4. Data model

### 4.1 `Comment` table (from `assets/waline.sql`, and identically across the pg/sqlite/tidb variants)

| Column | Type (MySQL) | Meaning |
| --- | --- | --- |
| `id` | `int unsigned AUTO_INCREMENT` | primary key; exposed to clients as `objectId` |
| `user_id` | `int` NULL | FK-ish to `Users.objectId`; NULL for anonymous commenters |
| `comment` | `text` | **sanitised HTML** (markdown already rendered) |
| `insertedAt` | `timestamp` default now | creation time; converted to `time` (epoch ms) in responses and removed from the JSON |
| `ip` | `varchar(100)` | commenter IP; returned only to administrators |
| `link` | `varchar(255)` | commenter website |
| `mail` | `varchar(255)` | commenter email; md5-hashed for non-admins |
| `nick` | `varchar(255)` | commenter display name (denormalised copy even for logged-in users) |
| `pid` | `int` | parent comment id (the specific comment being replied to) |
| `rid` | `int` | root comment id (NULL for root comments) |
| `sticky` | `boolean` | pinned to top of its article (root comments only, in practice) |
| `status` | `varchar(50)` NOT NULL default `''` | `approved` \| `waiting` \| `spam` |
| `like` | `int` | like counter |
| `ua` | `text` | raw user-agent string |
| `url` | `varchar(255)` | the article path (also called `path` in the client API — `WalineCommentData.url` carries a `// FIXME: Rename it to path` note) |
| `createdAt` / `updatedAt` | `timestamp` | bookkeeping; always stripped from responses |

Indexes: `url`, `user_id`, `status`, `(pid, rid)`, `createdAt`, `updatedAt`, `sticky`. Note there is **no index on `mail`** even though `mail` is used as a grouping/filter key for levels, user ranking, RSS-by-email, and duplicate detection.

### 4.2 Fields *computed at response time* (not stored on `Comment`)

`objectId` (= `id`), `time` (= `insertedAt` ms), `orig` (the raw markdown — only attached when a login user is present, and it is the pre-render value of `comment`), `avatar`, `type` (`administrator`/`guest`, only for logged-in users), `label`, `level`, `addr`, `browser`, `os`, `reply_user: {nick, link, avatar}` (child comments only), `children` (root comments only), `sticky` coerced from `0|1` to boolean.

Important nuance for a reimplementation: **`orig` is not a separate column.** It is the raw `comment` value captured before markdown rendering, surfaced only to a logged-in viewer. So an anonymous commenter's original markdown is unrecoverable, and admin "edit" on an anonymous comment edits rendered HTML.

### 4.3 `status` semantics

Exactly three values: `approved`, `waiting`, `spam`.
- `approved` — publicly visible and counted.
- `waiting` — created when `COMMENT_AUDIT` is on; visible **only** to its own author (when logged in), to administrators, and in the admin `waiting` filter; excluded from public counts; the author sees a "comment under review" notice.
- `spam` — flagged by Akismet or `FORBIDDEN_WORDS`; hidden like `waiting`, excluded from counts, surfaced in the admin `spam` filter.
- **Legacy data may have no status at all** (imported from Valine). Two compatibility shims exist: `where.status = ['NOT IN', ['waiting','spam']]` is used instead of `= 'approved'` for public reads, and the admin filter maps `approved` to the same `NOT IN` form.
- There is no `deleted` status, no `pending_author`, no `shadow`, no `pinned`-as-status; deletes are hard deletes.

### 4.4 `Users` table

`id`, `display_name` (NOT NULL default ''), `email` (NOT NULL default '', **UNIQUE**), `password` (phpass hash), `type` (NOT NULL default ''), `label`, `url`, `avatar`, `github`, `twitter`, `facebook`, `google`, `weibo`, `qq`, `oidc`, `huawei`, `2fa` (varchar(32), base32 TOTP secret), `createdAt`, `updatedAt`. Indexes on `email` (unique), `type`, `createdAt`.

`type` possible values: `administrator`, `guest`, `banned`, and the transient `verify:<4-digit-code>:<expiry-epoch-ms>`.

Notable: social provider ids live in **columns named after the provider** (`github`, … `huawei`), so adding a provider requires a schema change — the 2021-12-12 changelog entry documents exactly that migration pain for `twitter/facebook/google/weibo/qq`.

### 4.5 `Counter` table (pageviews + reactions + star ratings)

`id`, `time` (pageview counter), `reaction0`…`reaction8` (9 reaction slots), `url` (NOT NULL default ''), `createdAt`, `updatedAt`. Indexes on `url`, `time`, `createdAt`. There is **no unique constraint on `url`** — one row per path is assumed by the code (`select({url: path})` then update all matches), but nothing enforces it (**unverified whether duplicates occur in practice; the update path does handle multiple rows via `objectId IN (...)`**).

So pageviews, article reactions, and the 5-star rating all share one row per path with a fixed 10-column budget. Adding an 11th counter type needs a schema change. The `time` column being a plain counter with no per-visit records is the documented anti-tampering trade-off made versus Valine (see `advanced/design.md`).

### 4.6 Counters vs reactions vs likes vs pageviews — summary

| Concept | Storage | Update endpoint | Dedup | Auth |
| --- | --- | --- | --- | --- |
| Pageviews | `Counter.time` | `POST /api/article {path, type:'time', action:'inc'}` | none | none |
| Article reaction N | `Counter.reaction{N}` | `POST /api/article {type:'reactionN'}` / `action:'desc'` | localStorage `WALINE_REACTION` (one reaction per path) | none |
| Star rating | `Counter.reaction0..4` | same as reactions | same | none |
| Comment like | `Comment.like` | `PUT /api/comment/:id {like: bool}` | localStorage `WALINE_LIKE` (last 50 ids) | none |
| Comment count | derived (`COUNT(*)`) | — | — | — |

---

## 5. Deployment topologies

### 5.1 Client

- CDN script/module from unpkg or jsDelivr (`@waline/client@v3/dist/waline.js` + `waline.css`), or npm + bundler (`@waline/client`, `/full`, `/comment`, `/pageview`, `/component`).
- Optional CSS: `waline.css` plus `waline-meta.css` when the meta line is used.
- Framework plugins: `@waline/hexo-next` (in this monorepo), `vuepress-plugin-comment2`, `docsify-waline`, Gatsby, etc.
- Alternative clients implementing the same API: MiniValine, `sodesu` (Solid.js). A Rust server reimplementation `waline-mini` and a community Cloudflare Workers port `Waline_On_Worker` exist — the latter existing precisely because **the official server cannot run on Cloudflare Workers**.

### 5.2 Server platforms (documented)

Vercel (recommended default; `@waline/vercel` serverless function), CloudBase (Tencent), Railway, Render, Zeabur, Netlify (functions; `middleware/netlify.js` computes a `.netlify/functions/<handler>` prefix), Alibaba Cloud ComputeNest, Alibaba Cloud FC, Baidu CFC (Chinese-locale docs only), Docker (`lizheming/waline` image; `Dockerfile`, `Dockerfile.alpine`, `Dockerfile.source-build-alpine`, `docker-compose.yml`; exposes 8360), and plain VPS/self-host (`vanilla.js`). The README claims "at least 243 deployment choices" — that number is a marketing product of platform × storage combinations and should not be treated as 243 independently supported topologies (**unverified as a real count**).
- Netlify has an explicit constraint: the bundled function must stay under 50 MB (issue [#1936](https://github.com/walinejs/waline/issues/1936) reports exceeding it).
- Not supported officially: AWS/GCP/Azure are an unchecked TODO in the README; Cloudflare Workers and Tencent EdgeOne are community/open requests ([#2778](https://github.com/walinejs/waline/issues/2778), [#3169](https://github.com/walinejs/waline/issues/3169)).

### 5.3 Storage topologies

LeanCloud (the Valine-compatible option), MongoDB, MySQL, PostgreSQL, SQLite, TiDB, CloudBase, and GitHub-as-a-database. Serverless deployments pair with a hosted DB (the Vercel guide now walks through **Neon** Postgres; the docs note Supabase/Neon free 512 MB tiers and Tembo's 10 GB). For SQL backends the schema must be imported by hand before first use.

### 5.4 Operational characteristics implied by the architecture

- One deployment serves **one site** (one `SITE_URL`, one admin console, one notification target set, one storage). Multi-tenant/multi-domain is **not** supported — issue [#2006](https://github.com/walinejs/waline/issues/2006) "Single deployment supports multiple domain names or projects" is open with discussion.
- Every request performs an outbound fetch to the OAuth broker (`fetch-oauth-service` middleware) — the server is coupled to `oauth.lithub.cc` being reachable, and returns **502** for everything if it is not. Self-hosting the broker (`github.com/walinejs/auth`) via `OAUTH_URL` is the escape hatch.
- `connectionLimit: 1` for Postgres/TiDB, `workers: 1`, and no connection pooling tuning surface — fine for a blog, a bottleneck for anything busy.
- Comment posting awaits Akismet and then awaits each notification channel **serially**, so p95 latency is dominated by third-party services; the FAQ explicitly recommends disabling Akismet to speed things up.
- Configuration changes require a redeploy; there is no runtime config store.

---

## 6. Real-world pain points, limitations, and complaints

Sourced from the repo's own docs (stated non-goals) and from GitHub issue search via the GitHub REST API (repo `walinejs/waline`, 825 issues total; only ~28 open at the time of the query, so the project is mature and low-backlog). Issue counts/reactions are as returned by the API.

### 6.1 Stated non-goals and self-declared limits (first-party)

- **Positioning**: "A simple comment system with backend." The FAQ states Waline has had "a very clear position since its birth" and that "all versions released afterwards are modifications made around this position" — i.e. scope is deliberately constrained.
- **No realtime**: the issue tracker has no realtime feature and the docs never offer it; the notification story is email/IM push, not live updates. Related user pain: [#74](https://github.com/walinejs/waline/issues/74) "评论无法自动刷新及评论通知问题" (23 comments) — comments do not auto-refresh; [#626](https://github.com/walinejs/waline/issues/626) asked for a manual refresh button (shipped).
- **Reaction counting is positional and documented as such**, with a pointer to [#1451](https://github.com/walinejs/waline/issues/1451) instead of a fix.
- **Only 9 reactions max**, documented.
- **Posting is slow by design** (serial Akismet + notifications) — the FAQ's answer is to turn features off.
- **Upgrading the server is manual** on every platform (edit `package.json` on Vercel, "save and reinstall dependencies" on CloudBase, `docker pull` on Docker), and the CloudBase path warns that redeployment clears files.
- **The server cannot run on edge runtimes** (Cloudflare Workers needs a community fork).
- **README TODO still open**: "AWS, GCP, Azure deploy support".

### 6.2 Complaints, grouped

**Single site / multi-site.** [#2006](https://github.com/walinejs/waline/issues/2006) (open, 6 comments) requests a single deployment serving multiple domains or projects. Today the workaround is to reuse one instance and namespace by `path` — but the admin console then shows all sites' comments in one flat list with no site/path filter, so moderation across sites is impractical.

**Moderation ergonomics (verified in source, echoed by users).** The admin can filter only by owner/status/keyword; keyword search runs against rendered HTML; there is no path filter, no thread view, no sorting, no per-user drill-down, no bulk batching (just `Promise.all`), no saved views, no dashboard analytics, and **no settings UI at all**. Replying as admin forces a full page reload. Delete is a native `confirm()`. Related: [#2218](https://github.com/walinejs/waline/issues/2218) "管理后台无法拉取评论" (7 comments), [#65](https://github.com/walinejs/waline/issues/65) "后台无法删除评论（CloudBase 部署）" (22 comments).

**Spam handling.** Akismet is enabled by default **with a shared public demo key**, is skipped entirely when `COMMENT_AUDIT` is on, and its errors are swallowed — so failures are silent. The alternative (forbidden words) is a single unanchored, unescaped regex. There is no shadow banning ([#2879](https://github.com/walinejs/waline/issues/2879)), no reputation, no per-user limits, no CAPTCHA-less heuristics, and no spam "learning" from admin decisions. Requests for more captcha options ([#3441](https://github.com/walinejs/waline/issues/3441), 15 comments, open) and captcha for anonymous comments ([#453](https://github.com/walinejs/waline/issues/453), 25 comments) are long-standing.

**No realtime / no notifications inbox.** [#2553](https://github.com/walinejs/waline/issues/2553) asks for a notification centre; [#1982](https://github.com/walinejs/waline/issues/1982) asks for event listeners. Commenters get no in-app signal that someone replied — only an email or nothing.

**Rate limiting.** One comment per IP per 60 s **per instance**, not per article, and it is a non-atomic read-then-write. [#482](https://github.com/walinejs/waline/issues/482) "IPQPS 不起作用" (21 comments) reports it not working. Shared IPs (offices, campuses, CGNAT) are penalised; admins are exempt.

**Migration difficulty.** Moving Valine/LeanCloud data in is the single most-discussed issue in the repo ([#51](https://github.com/walinejs/waline/issues/51), 65 comments). Import is an O(n)-request, non-transactional, progress-less loop over `/api/db`, and importing while switching storage engines has produced hard failures ([#1747](https://github.com/walinejs/waline/issues/1747) `NOT NULL constraint failed`; [#3488](https://github.com/walinejs/waline/issues/3488) Artalk import "not valid JSON"). Schema additions (e.g. the social-login columns) have historically required manual `ALTER TABLE` on self-managed SQL.

**Storage limits and serverless friction.** Vercel serverless + hosted DB implies free-tier caps; the docs steer users to 512 MB Neon/Supabase tiers or Tembo's 10 GB. Netlify's 50 MB function limit has bitten users ([#1936](https://github.com/walinejs/waline/issues/1936)). CloudBase has been a persistent source of deployment pain ([#57](https://github.com/walinejs/waline/issues/57) 22 comments, [#56](https://github.com/walinejs/waline/issues/56) 21 comments). Vercel deploy failures are the second most-discussed issue ([#1334](https://github.com/walinejs/waline/issues/1334), 32 comments) with follow-ups ([#1994](https://github.com/walinejs/waline/issues/1994), [#1827](https://github.com/walinejs/waline/issues/1827), [#2264](https://github.com/walinejs/waline/issues/2264)). The default base64 image path hard-caps images at 128 KB ([#2120](https://github.com/walinejs/waline/issues/2120)) and pushes storage cost into the DB/comments themselves.

**UGC / avatar / identity.** Avatars depend on an external proxy (`AVATAR_PROXY`, default a Cloudflare Worker at `avatar.75cdn.workers.dev`) plus libravatar/QQ lookups — an availability and privacy dependency ([#724](https://github.com/walinejs/waline/issues/724) "头像问题", 21 comments). Avatar upload does not exist ([#2677](https://github.com/walinejs/waline/issues/2677)). Social login synthesises fake emails that break notifications ([#3359](https://github.com/walinejs/waline/issues/3359)).

**Login/email operational pain.** [#1998](https://github.com/walinejs/waline/issues/1998) "邮箱无法发送，无法登录" (7 comments), [#2143](https://github.com/walinejs/waline/issues/2143) blogger notifications not arriving (10 comments), [#2888](https://github.com/walinejs/waline/issues/2888) notifications stopped working (4 comments). Registration becomes *harder* when SMTP is configured (mandatory email confirmation), and password reset is impossible without SMTP. No OAuth2/OIDC mail sending ([#2878](https://github.com/walinejs/waline/issues/2878)).

**Client / UX.** Mobile reply button didn't respond ([#627](https://github.com/walinejs/waline/issues/627), 23 comments). Only "load more", no numbered pagination ([#3203](https://github.com/walinejs/waline/issues/3203), open). Emoji system limitations ([#3515](https://github.com/walinejs/waline/issues/3515), open). GIF-search UI bugs ([#2036](https://github.com/walinejs/waline/issues/2036), [#1449](https://github.com/walinejs/waline/issues/1449)). Comment count fetching failed in a release ([#2534](https://github.com/walinejs/waline/issues/2534), 17 comments). Login/LaTeX regressions in v3 ([#2422](https://github.com/walinejs/waline/issues/2422)). Forced-login UI bugs ([#2680](https://github.com/walinejs/waline/issues/2680)). A blank-page bug on the instance root ([#3616](https://github.com/walinejs/waline/issues/3616), 21 comments). Double-click double-liking ([#2710](https://github.com/walinejs/waline/issues/2710)).

**Moderation/audit correctness bugs.** [#2562](https://github.com/walinejs/waline/issues/2562) (7 comments): with `COMMENT_AUDIT` on, a first-time submission is still displayed to the submitter before approval. [#2518](https://github.com/walinejs/waline/issues/2518) (9 comments): `Cannot read properties of undefined (reading 'nick')` from abnormal parent/child data — the code now has a guard for exactly this. [#3696](https://github.com/walinejs/waline/issues/3696): server 500 `Cannot read properties of null (reading '4')`. [#2114](https://github.com/walinejs/waline/issues/2114): `Cannot use 'in' operator to search for 'updatedAt' in undefined` (legacy routes).

**Feature gaps people keep asking for.** Integrating an external/own login system ([#2711](https://github.com/walinejs/waline/issues/2711), [#2837](https://github.com/walinejs/waline/issues/2837)) — the current answer is a custom storage/user model; site-wide UV counting ([#965](https://github.com/walinejs/waline/issues/965)); a better "hotness" algorithm ([#1679](https://github.com/walinejs/waline/issues/1679), open); event hooks for the client ([#1982](https://github.com/walinejs/waline/issues/1982), open).

### 6.3 Design weaknesses I found by reading the code (not necessarily reported by users)

These are the ones I would treat as explicit "do better" items in a new design; each is grounded in a specific code path cited above.

1. **Like/reaction/pageview integrity is client-trusted.** All three de-duplicate in `localStorage` and accept unauthenticated writes. Clearing storage or calling the API directly inflates counts arbitrarily.
2. **Two markdown pipelines** (markdown-it server-side for storage, marked client-side for preview) can and do diverge ([#2422](https://github.com/walinejs/waline/issues/2422) is a LaTeX double-render).
3. **Rendered HTML is the stored representation**, so full-text search, re-rendering after a parser fix, and "edit original" for anonymous comments are all impossible; and the admin keyword filter searches markup.
4. **`orig` is not persisted**, so the promise of "you can edit your comment's markdown" only holds for logged-in users and only within the same request cycle.
5. **Deleting a root comment silently deletes all replies** (`_complex OR {objectId, pid, rid}`) with no confirmation of blast radius.
6. **`rid`-based threading is capped at 2 levels** and loads all replies for a page in one unbounded query — a popular article's replies are not paginated.
7. **No unique constraint on `Counter.url`** while the code assumes one row per path.
8. **No index on `Comment.mail`** despite heavy use of `mail` as a grouping key.
9. **JWT has no expiry and no revocation**, is stored in `localStorage`, and its signing key silently falls back to a database password. `DELETE /api/token` is a no-op.
10. **Password-reset magic links are non-expiring JWTs** delivered by email.
11. **`GET /api/token/2fa?email=` discloses whether an account exists and has 2FA** — unauthenticated account enumeration.
12. **`FORBIDDEN_WORDS` is interpolated into a `RegExp` unescaped.**
13. **`fetch-oauth-service` makes an external HTTP call on every request** and 502s the entire server when the broker is down.
14. **`referrerCheck` 403s requests with neither `Referer` nor `Origin`** when `SECURE_DOMAINS` is set — this can block server-to-server or privacy-stripped clients.
15. **The client's `?token=` handler calls `${serverURL}/token` instead of `${serverURL}/api/token`** (`packages/client/src/components/WalineComment.vue`), inconsistent with every other call which goes through `getFetchPrefix()`. Likely broken; **unverified whether intentional**.
16. **`RecentComments` builds HTML by string concatenation** with unescaped `nick`/`url`.
17. **The admin reply flow calls `location.reload()`.**
18. **No transactions anywhere** — deletes, imports, and status changes are single-statement or per-row HTTP loops.
19. **Docs/code drift is systemic**: the English i18n doc lists 18 languages while the code ships 23 tags / 13 bundles; the server API doc documents only the comment and article endpoints and omits `type=list`, `recent`, RSS, token, user, db, oauth and verification; `afterUpdate`/`afterDelete` vs `postUpdate`/`postDelete`; `RecentComments`' result key described as `comment` but implemented as `comments`; and `packages/server/openapi.yaml` omits four live endpoints (`/api/article`, `/api/token/2fa`, `/api/user/password`, `/api/verification`).

---

## 7. Things the brief assumed that are NOT true of Waline

Stated explicitly so the baseline is not built on a false premise:

| Assumed | Reality |
| --- | --- |
| `/api/upload` endpoint | **Does not exist.** Upload is a client callback only; the default is a 128 KB-capped base64 data URL. |
| `/api/reaction` endpoint | **Does not exist.** Reactions are `Counter.reactionN` columns written via `POST /api/article`. |
| `/api/config` endpoint | **Does not exist.** No runtime/dashboard configuration at all. |
| `/api/notify` endpoint | **Does not exist.** Notifications fire inside the comment write path; the only outbound hook is `WEBHOOK`. |
| Magic-link email login for commenters | **Not implemented.** Registration uses an emailed *confirmation* link; login is password (+ optional TOTP); only password *reset* is a magic link. |
| Configurable reply depth / `maxDepth` | **No such option.** Depth is hardcoded to 2 (root + flat children). |
| Dislike reactions on comments | **Does not exist.** Only `like` (a monotonic counter with a local un-like). |
| Real server-side comment search | **Does not exist** for the public API; the admin `keyword` filter is a `LIKE` over rendered HTML. |
| Bulk actions with batching | Only `Promise.all` fan-out over individual PUT/DELETE calls. |
| Comment-count element via `id` | Removed in v3; `data-path` is required. |
| `recordIP` option (Valine) | Removed; replaced by `DISABLE_USERAGENT`/`DISABLE_REGION` and admin-only IP visibility. |

---

## 8. Condensed requirements baseline (what Waline gives you, and where to aim higher)

**Keep (they are load-bearing and users rely on them):** `serverURL` + `path` article identity; `data-path`-driven `.waline-comment-count` / `.waline-pageview-count` elements; the `{errno, errmsg, data}` envelope; Markdown with server-side sanitisation; emoji presets addressable by URL convention; `meta`/`requiredMeta` anonymous commenting; `login: enable|disable|force` paired with server-side `LOGIN=force`; `dark` tri-state; `commentSorting` latest/oldest/hottest; RSS per article/site/user; the eight IM/email notification channels; serverless-friendly multi-storage; hooks + Koa plugin middlewares; `WalineInstance.update()/destroy()`; the standalone `<1 KB` comment/pageview bundles; widgets `RecentComments`/`UserList`.

**Fix / redesign (each is a verified Waline weakness from §6.3):** persist raw markdown alongside rendered HTML; a single shared markdown engine; server-side identity for likes/reactions/ratings; a real rate limiter (per user *and* per IP, atomic, per-article aware); a proper moderation console (path/site filter, thread view, sorting, batched bulk ops with partial-failure reporting, settings UI, dashboard, CSV export, non-blocking admin reply); notifications decoupled from the request path (queue) with per-user preferences and an in-app inbox; threading depth as an explicit, configurable design decision rather than 2-by-default; pagination that covers replies; a settings/config store that does not require redeploy; an admin-editable spam ruleset plus shadow-ban; expiring, revocable tokens stored outside `localStorage`; and a documented, versioned schema-migration path.

---

## 9. Sources

**Repository (primary evidence — cloned at commit `43a1e85e`, 2026-09-14):** <https://github.com/walinejs/waline>

Key files read: `README.md`, `README_CN.md`, `CHANGELOG.md`, `packages/client/package.json`, `packages/client/src/typings/{options,waline,base,locale}.d.ts`, `packages/client/src/{init,comment,pageview}.ts`, `packages/client/src/config/{default,index,sortKey}.ts`, `packages/client/src/config/i18n/*`, `packages/client/src/utils/{config,darkmode,userAgent}.ts`, `packages/client/src/composables/{userInfo,like,reaction,inputs}.ts`, `packages/client/src/components/{WalineComment,CommentCard,CommentBox,ArticleReaction}.vue`, `packages/client/src/widgets/{recentComments,userList}.ts`, `packages/client/src/widgets/star/*`, `packages/api/src/{typings,comment,user,login,articleCounter,commentCount,pageview,recentComment,utils}.ts`, `packages/server/openapi.yaml`, `packages/server/index.js`, `packages/server/vanilla.js`, `packages/server/Dockerfile`, `packages/server/src/config/{config,adapter,middleware,extend,router,netlify}.js`, `packages/server/src/controller/{comment,user,article,token,oauth,verification,db,index,rest}.js`, `packages/server/src/controller/{token/2fa,user/password,comment/rss}.js`, `packages/server/src/logic/{base,comment,user,token,db}.js`, `packages/server/src/service/{notify,akismet,avatar}.js`, `packages/server/src/service/markdown/{index,xss}.js`, `packages/server/src/locales/index.js`, `packages/server/src/middleware/{dashboard,plugin,fetch-oauth-service}.js`, `assets/waline.sql`, `assets/waline.sqlite.sql`, `assets/waline.pgsql`, `packages/admin/src/pages/{manage-comments,user,profile,migration}/index.jsx`, `packages/admin/src/services/{comment,user,auth}.js`, `packages/admin/src/locales/index.js`, `packages/admin/package.json`.

**Official documentation** (repo markdown under `docs/src/en/`, published URLs verified HTTP 200):
- <https://waline.js.org/en/> — docs home
- <https://waline.js.org/en/guide/features/> — feature index
- <https://waline.js.org/en/guide/features/comment.html> — comment counter
- <https://waline.js.org/en/guide/features/emoji.html> — emoji presets
- <https://waline.js.org/en/guide/features/i18n.html> — i18n
- <https://waline.js.org/en/guide/features/notification.html> — notification channels & env vars
- <https://waline.js.org/en/guide/features/pageview.html> — pageviews
- <https://waline.js.org/en/guide/features/reaction.html> — article reactions
- <https://waline.js.org/en/guide/features/safety.html> — security model
- <https://waline.js.org/en/guide/features/search.html> — GIF search
- <https://waline.js.org/en/guide/features/syntax.html> — markdown
- <https://waline.js.org/en/guide/features/style.html> — theming/dark mode
- <https://waline.js.org/en/guide/features/label.html> — user labels
- <https://waline.js.org/en/guide/features/widget/recent-comment.html>
- <https://waline.js.org/en/guide/features/widget/user-list.html>
- <https://waline.js.org/en/guide/database.html> — storage options
- <https://waline.js.org/en/guide/deploy/> and `/en/guide/deploy/vercel.html`, `/railway.html`, `/netlify.html`, `/zeabur.html`, `/tidb.html`, `/vps.html`, `/aliyun-computenest.html`
- <https://waline.js.org/en/guide/get-started/>
- <https://waline.js.org/en/reference/client/props.html> — client options
- <https://waline.js.org/en/reference/client/api.html>, `/file.html`, `/style.html`
- <https://waline.js.org/en/reference/server/api.html> — server API (stale; code is authoritative)
- <https://waline.js.org/en/reference/server/env.html> — env vars
- <https://waline.js.org/en/reference/server/config.html> — `index.js` options & hooks
- <https://waline.js.org/en/reference/server/plugin.html> — plugin system
- <https://waline.js.org/en/advanced/faq.html>, `/design.html`, `/intro.html`, `/ecosystem.html`, `/privacy.html`
- <https://waline.js.org/en/cookbook/customize/emoji.html>, `/upload-image.html`, `/locale.html`, `/database.html`, `/userdb.html`
- <https://waline.js.org/en/migration/v3.html>, `/valine.html`, `/tool.html`

**Issue evidence** (via the GitHub REST search API, `repo:walinejs/waline`):
[#51](https://github.com/walinejs/waline/issues/51) · [#56](https://github.com/walinejs/waline/issues/56) · [#57](https://github.com/walinejs/waline/issues/57) · [#65](https://github.com/walinejs/waline/issues/65) · [#74](https://github.com/walinejs/waline/issues/74) · [#453](https://github.com/walinejs/waline/issues/453) · [#482](https://github.com/walinejs/waline/issues/482) · [#626](https://github.com/walinejs/waline/issues/626) · [#627](https://github.com/walinejs/waline/issues/627) · [#724](https://github.com/walinejs/waline/issues/724) · [#965](https://github.com/walinejs/waline/issues/965) · [#1334](https://github.com/walinejs/waline/issues/1334) · [#1425](https://github.com/walinejs/waline/issues/1425) · [#1449](https://github.com/walinejs/waline/issues/1449) · [#1451](https://github.com/walinejs/waline/issues/1451) · [#1679](https://github.com/walinejs/waline/issues/1679) · [#1747](https://github.com/walinejs/waline/issues/1747) · [#1788](https://github.com/walinejs/waline/issues/1788) · [#1827](https://github.com/walinejs/waline/issues/1827) · [#1936](https://github.com/walinejs/waline/issues/1936) · [#1982](https://github.com/walinejs/waline/issues/1982) · [#1994](https://github.com/walinejs/waline/issues/1994) · [#1998](https://github.com/walinejs/waline/issues/1998) · [#2006](https://github.com/walinejs/waline/issues/2006) · [#2036](https://github.com/walinejs/waline/issues/2036) · [#2114](https://github.com/walinejs/waline/issues/2114) · [#2120](https://github.com/walinejs/waline/issues/2120) · [#2143](https://github.com/walinejs/waline/issues/2143) · [#2218](https://github.com/walinejs/waline/issues/2218) · [#2264](https://github.com/walinejs/waline/issues/2264) · [#2280](https://github.com/walinejs/waline/issues/2280) · [#2347](https://github.com/walinejs/waline/issues/2347) · [#2422](https://github.com/walinejs/waline/issues/2422) · [#2518](https://github.com/walinejs/waline/issues/2518) · [#2534](https://github.com/walinejs/waline/issues/2534) · [#2553](https://github.com/walinejs/waline/issues/2553) · [#2562](https://github.com/walinejs/waline/issues/2562) · [#2591](https://github.com/walinejs/waline/issues/2591) · [#2634](https://github.com/walinejs/waline/issues/2634) · [#2661](https://github.com/walinejs/waline/issues/2661) · [#2677](https://github.com/walinejs/waline/issues/2677) · [#2680](https://github.com/walinejs/waline/issues/2680) · [#2710](https://github.com/walinejs/waline/issues/2710) · [#2711](https://github.com/walinejs/waline/issues/2711) · [#2778](https://github.com/walinejs/waline/issues/2778) · [#2837](https://github.com/walinejs/waline/issues/2837) · [#2878](https://github.com/walinejs/waline/issues/2878) · [#2879](https://github.com/walinejs/waline/issues/2879) · [#2888](https://github.com/walinejs/waline/issues/2888) · [#3023](https://github.com/walinejs/waline/issues/3023) · [#3169](https://github.com/walinejs/waline/issues/3169) · [#3203](https://github.com/walinejs/waline/issues/3203) · [#3208](https://github.com/walinejs/waline/issues/3208) · [#3350](https://github.com/walinejs/waline/issues/3350) · [#3359](https://github.com/walinejs/waline/issues/3359) · [#3441](https://github.com/walinejs/waline/issues/3441) · [#3488](https://github.com/walinejs/waline/issues/3488) · [#3515](https://github.com/walinejs/waline/issues/3515) · [#3555](https://github.com/walinejs/waline/issues/3555) · [#3616](https://github.com/walinejs/waline/issues/3616) · [#3696](https://github.com/walinejs/waline/issues/3696) · [#3770](https://github.com/walinejs/waline/issues/3770) · [#3836](https://github.com/walinejs/waline/issues/3836) · [#3821](https://github.com/walinejs/waline/issues/3821)

**Related/adjacent repos referenced by the docs:** <https://github.com/walinejs/auth> (self-hostable OAuth broker), <https://github.com/walinejs/plugins>, <https://github.com/walinejs/emojis>, <https://github.com/lizheming/waline> (Docker image source).

**Correction to the brief's source list:** `https://github.com/walinejs/waline-admin` **returns HTTP 404 — that repository does not exist** (verified directly; the raw README on both `main` and `master` also 404s). The admin console now lives at `packages/admin` inside the `walinejs/waline` monorepo, confirmed via npm registry metadata for `@waline/admin@0.34.2`, whose `repository` field is `{url: 'https://github.com/walinejs/waline.git', directory: 'packages/admin'}`. All admin findings in §3 come from that source.

**Explicitly marked unverified in this report:** whether `${serverURL}/token` in `WalineComment.vue` is an intentional path or a bug; whether the shared default Akismet key `70542d86693e` is still valid/rate-limited in practice; whether duplicate rows ever appear in `Counter` for one `url`; whether the unescaped `FORBIDDEN_WORDS` regex is exploitable in practice; whether the non-expiring password-reset JWT is deliberate; whether the `RecentComments`/`UserList` unescaped interpolation is exploitable; and the accuracy of the "243 deployment choices" claim.
