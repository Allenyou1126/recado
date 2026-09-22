# TanStack Start (React, v1.x) — Capability Report for a Production Comment-System Backend on Node.js

> **归档说明（本仓库整理时补记）**
> 本报告是一次性研究产物，**保留原始内容不改**，仅更正路径信息：
> 核查时搭建的验证应用（`.tsresearch/verify/app`）与文档克隆（`.tsresearch/router`）
> 已在本仓库整理时删除。正文 §11 描述的方法仍然可用，可按其步骤重建验证环境。
> **重建验证环境的要点**：`npx @tanstack/cli@latest create` 起一个最小应用，
> 用 `nitro()` 插件构建后 `node .output/server/index.mjs` 运行，
> **CORS 预检必须在生产构建下测**（dev 下框架会绕过 `OPTIONS` 处理器）。
> 结论层面无需重建即可采信：正文每条判断均带证据标签（`[VERIFIED-RUNTIME]` / `[VERIFIED-SOURCE]` / `[DOC]` / `[UNVERIFIED]`）。

**Research date:** 2026-09-22
**Primary sources:** official docs markdown source in `TanStack/router@fe7f1fd0e6ef73c3f341dd2338b406749538a85d` (branch `main`, committed 2026-09-21), the published docs at `tanstack.com/start/latest/...` (append `.md` for raw markdown), package source in `packages/{react-start,start-client-core,start-server-core,start-plugin-core}`, npm registry metadata, and **a real TanStack Start app that I scaffolded, ran in dev, and built + ran in production** (Node/Nitro) to verify behaviour empirically.

**Evidence labels used throughout:**
- **[VERIFIED-RUNTIME]** — I observed this myself by running a real app (dev server + production Node build). Raw logs are reproducible from the method in §11.
- **[VERIFIED-SOURCE]** — read directly in the shipping TypeScript source.
- **[DOC]** — stated in official documentation.
- **[UNVERIFIED]** / **[INFERENCE]** — explicitly flagged; do not treat as fact.

---

## 0. TL;DR — the decision-relevant answers

| Question | Answer |
|---|---|
| **Can a static blog's `fetch()` POST directly to a `createServerFn` URL?** | **No.** Four independent blockers: (1) a same-origin CSRF check rejects cross-origin callers with `403 Forbidden`; (2) the request body must be **seroval** `toJSON` output, not plain JSON — plain JSON throws and returns HTTP 500; (3) the `x-tsr-serverFn: true` header is mandatory or you get an opaque 500; (4) the response is a seroval `toCrossJSON` envelope `{result, error, context}` and handler-level errors come back with **HTTP 200**. **Use server routes for anything a non-TanStack client must call.** |
| **Are plain REST routes available?** | **Yes, and they are excellent.** `createFileRoute('/api/x')({ server: { handlers: { GET, POST, OPTIONS, ... } } })` returning standard web `Response` objects. Verified working for JSON bodies, query params, headers, custom status codes, custom headers, dynamic params, escaped filenames, `DELETE`, and SSE. |
| **Is CORS built in?** | **No — zero CORS support anywhere in the codebase.** You write the headers yourself. An explicit `OPTIONS` handler per route is required; a route without one falls through to the SSR app shell (`200 text/html`, no CORS headers), which fails preflight. |
| **Server-side rendering for SEO?** | **Yes, on by default**, per-route controllable (`ssr: true \| false \| 'data-only'`, plus a functional form). Loaders are isomorphic and their data is dehydrated into the HTML. |
| **Node.js / Docker deploy?** | **Yes.** The official example template uses the `nitro/vite` plugin and ships `.output/server/index.mjs`, started with `node .output/server/index.mjs`. Rsbuild output is a fetch-handler module you can serve with `srvx`, Express, etc. |
| **ORM / migrations documented?** | **Barely.** `guide/databases.md` is a 109-line marketing page with an undefined `createMyDatabaseClient()` placeholder. **Zero** mentions of Drizzle, `drizzle-kit`, Prisma setup, Kysely, `better-sqlite3`, or any migration workflow. You will be designing this yourself. |
| **Built-in auth/sessions?** | **Partly.** `useSession()` (h3-backed, encrypted cookie) is documented; `getSession`, `updateSession`, `sealSession`, `unsealSession`, `clearSession`, `getCookie`, `setCookie`, `deleteCookie` all exist in source but most are undocumented. No CSRF tokens, no rate limiter, no OAuth helpers. |
| **Cron / queues / background jobs?** | **No built-in anything.** No scheduler, no job runner, no queue abstraction. On a long-running Node process, module-scope timers work. On Cloudflare, you extend `src/server.ts` with Workers `scheduled`/`queue` handlers. |
| **SSE?** | **Yes, works** — a server route returning a `ReadableStream` with `Content-Type: text/event-stream` streamed correctly in both dev and production. |
| **WebSocket?** | **No support in the framework.** The server contract is a WinterCG `fetch(request) => Response`; there is no upgrade hook. |
| **Is it actually "v1 stable"?** | **Ambiguous, and worth knowing before you commit.** npm `latest` is `1.168.57`, but no `1.0.0` was ever published and **the official docs still say "Release Candidate"** as of this research. See §1.1. |

---

## 1. Current version, packages, and scaffolding

### 1.1 Version status — read this before planning

**[VERIFIED-RUNTIME — npm registry]**

```
@tanstack/react-start        latest = 1.168.57   (published 2026-09-21)
@tanstack/start-client-core  latest = 1.170.32
@tanstack/start-server-core  latest = 1.169.37
@tanstack/start-plugin-core  latest ≈ 1.168.x
@tanstack/router-plugin      latest = 1.168.40
@tanstack/cli                latest = 0.71.0
```

**[VERIFIED-RUNTIME — npm registry]** There is **no `1.0.0` release** of `@tanstack/react-start`. The version line jumped straight from `0.0.1-beta.204` to `1.111.10` on **2025-02-25** — i.e. the TanStack-wide version alignment *is* the "v1" line, and it began life labelled as the Release Candidate.

**[VERIFIED-RUNTIME — live docs]** The official "latest" docs still carry the RC banner, and so does the blog post URL you gave me:

> TanStack Start is currently in the **Release Candidate** stage! This means it is considered feature-complete and its API is considered stable. **This does not mean it is bug-free or without issues** … The road to v1 will likely be a quick one.

Source: `https://tanstack.com/start/latest/docs/framework/react/overview.md` and `https://tanstack.com/blog/announcing-tanstack-start-v1` (title: "TanStack Start v1 Release Candidate").

Third-party press ([InfoQ, 2025-11-07](https://www.infoq.com/news/2025/11/tanstack-start-v1/)) and various blog posts describe TanStack Start "v1" as released. **My honest read:** the 1.x API is declared stable and is shipping fast (747 releases in the 1.x line), but the project has *not* updated its own docs to remove the RC caveat. Treat "v1 stable" as "API-stable RC under continuous release", and pin exact versions. **[INFERENCE — the docs/press discrepancy is unresolved and I could not find an official stable-release announcement.]**

### 1.2 Package names

**[DOC — `build-from-scratch.md`, `getting-started.md`]** The application package is **`@tanstack/react-start`**. There is **no** `@tanstack/start` app package — the bare `@tanstack/start` string appears in the docs only as an ESLint plugin namespace.

| Purpose | Package |
|---|---|
| Framework | `@tanstack/react-start` |
| Router | `@tanstack/react-router` |
| Vite plugin | `@tanstack/react-start/plugin/vite` (subpath, not a separate package) |
| Rsbuild plugin | `@tanstack/react-start/plugin/rsbuild` |
| Server helpers | `@tanstack/react-start/server` |
| Server entry | `@tanstack/react-start/server-entry` |
| Client entry | `@tanstack/react-start/client` |
| Static server fns (experimental) | `@tanstack/start-static-server-functions` |
| Node/runtime adapter | `nitro` (devDependency) |

**[VERIFIED-RUNTIME]** `@tanstack/react-start@1.168.57` peer deps: `vite >=7.0.0`, `react >=18.0.0 || >=19.0.0`, `@rsbuild/core ^2.0.0`. No peer requirement on nitro.

### 1.3 Scaffolding

**[DOC — `getting-started.md`]**

```bash
npx @tanstack/cli@latest create
```

Or clone an official example (no build config to get wrong):

```bash
npx gitpick TanStack/router/tree/main/examples/react/start-basic start-basic
cd start-basic && npm install && npm run dev
```

Useful example slugs: `start-basic`, `start-basic-rsbuild`, `start-basic-auth` (DIY auth + sessions + Prisma), `start-basic-react-query`, `start-clerk-basic`, `start-workos`, `start-supabase-basic`, `start-convex-trellaux`.

Manual install **[DOC — `build-from-scratch.md`]**:

```bash
npm i @tanstack/react-start @tanstack/react-router
npm i react react-dom
npm i -D vite @vitejs/plugin-react          # or: -D @rsbuild/core @rsbuild/plugin-react
npm i -D typescript @types/react @types/react-dom @types/node
```

### 1.4 The official template, verbatim

**[VERIFIED-RUNTIME — `examples/react/start-basic/package.json` on `main`]** — note **nitro is a devDependency and the start script points at Nitro's output**:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build && tsc --noEmit",
    "preview": "vite preview",
    "start": "node .output/server/index.mjs"
  },
  "dependencies": {
    "@tanstack/react-router": "^1.170.38",
    "@tanstack/react-start": "^1.168.57",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "nitro": "^3.0.260311-beta",
    "vite": "^8.0.14"
  }
}
```

**[VERIFIED-RUNTIME — `examples/react/start-basic/vite.config.ts`]**

```ts
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: 'src' }),
    viteReact(),      // react's plugin must come AFTER start's plugin
    nitro(),
  ],
})
```

### 1.5 Directory layout and required files

**[DOC — `build-from-scratch.md`, `routing.md`]**

```
.
├── src/
│   ├── routes/
│   │   ├── __root.tsx        # required: document shell
│   │   └── ...
│   ├── router.tsx            # required: exports getRouter()
│   └── routeTree.gen.ts      # GENERATED — never edit
├── vite.config.ts
├── package.json
└── tsconfig.json
```

Optional entry points, all with framework defaults: `src/start.ts` (global middleware), `src/server.ts` (server entry), `src/client.tsx` (client entry).

```tsx
// src/router.tsx — must export getRouter() returning a NEW router per call
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true })
}
```

```tsx
// src/routes/__root.tsx
import type { ReactNode } from 'react'
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { title: 'My App' }] }),
  component: () => (<RootDocument><Outlet /></RootDocument>),
})

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}
```

**Two `tsconfig` traps [DOC]:**
- Keep **`verbatimModuleSyntax` disabled** — "Enabling `verbatimModuleSyntax` can result in server bundles leaking into client bundles."
- `@tanstack/react-start` ships `"typescript": "npm:@typescript/typescript6@^6.0.2"` and `@typescript/native` in the official example — the toolchain is bleeding-edge. Pin it.

---

## 2. Server functions (`createServerFn`) — and whether external clients can call them

### 2.1 How they work

**[DOC — `guide/server-functions.md`]** A server function is a server-only implementation with a compiler-generated RPC stub on the client:

```tsx
import { createServerFn } from '@tanstack/react-start'

export const getServerTime = createServerFn().handler(async () => {
  return new Date().toISOString()   // runs only on the server
})

// call from loaders, components (via useServerFn), event handlers, other server fns
const time = await getServerTime()
```

**[VERIFIED-RUNTIME]** The build transform is visible in the dev-served client module. My `src/utils/test.functions.ts` compiled to:

```js
import { createClientRpc } from "/node_modules/@tanstack/react-start/dist/esm/client-rpc.js";
import { createServerFn } from "/node_modules/@tanstack/react-start/dist/esm/index.js";
export const getTime = createServerFn({ method: "GET" }).handler(createClientRpc("eyJmaWxlIjoiL3NyYy91dGlscy90ZXN0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJnZXRUaW1lX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ"));
export const addComment = createServerFn({ method: "POST" }).handler(createClientRpc("eyJmaWxlIjoiL3NyYy91dGlscy90ZXN0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJhZGRDb21tZW50X2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ"));
```

Decoded dev IDs:

```
{"file":"/src/utils/test.functions.ts?tss-serverfn-split","export":"getTime_createServerFn_handler"}
{"file":"/src/utils/test.functions.ts?tss-serverfn-split","export":"addComment_createServerFn_handler"}
```

The real implementation is stripped from the client bundle; the client calls `createClientRpc(id)`, which is a `fetch` wrapper.

### 2.2 Input validation

**[VERIFIED-SOURCE — `packages/start-client-core/src/createServerFn.ts:892-914`]** `.validator()` accepts exactly three shapes, resolved at runtime:

```ts
export async function execValidator(validator: AnyValidator, input: unknown): Promise<unknown> {
  if (validator == null) return {}
  if ('~standard' in validator) {                 // Standard Schema (zod 3.24+, valibot, arktype …)
    const result = await validator['~standard'].validate(input)
    if (result.issues) throw new Error(JSON.stringify(result.issues, undefined, 2))
    return result.value
  }
  if ('parse' in validator) return validator.parse(input)   // zod, valibot, etc.
  if (typeof validator === 'function') return validator(input)
  throw new Error('Invalid validator type!')
}
```

So **zod works directly, no adapter package needed**:

```tsx
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const NewComment = z.object({
  postId: z.string().min(1),
  author: z.string().min(1).max(80),
  body: z.string().min(1).max(5000),
})

export const addComment = createServerFn({ method: 'POST' })
  .validator(NewComment)
  .handler(async ({ data }) => {
    // data is fully typed as z.infer<typeof NewComment>
    return db.insert(comments).values(data).returning()
  })
```

**[VERIFIED-SOURCE — `createServerFn.ts:88-93, 509-518, 123-124`]** `.validator` and `.inputValidator` are **the same function**; `inputValidator` carries `@deprecated Use 'validator' instead.` and `// TODO remove upon stable`. Note the docs are inconsistent here (some pages still show `inputValidator`, and `middleware.md` shows `zodValidator(mySchema)` from `@tanstack/zod-adapter` for middleware-level validators). Use `.validator()`.

**Serialization type-checking [DOC]** is on by default ("strict" mode): validator *inputs* and handler *returns* must be serializable (with `FormData` allowed for POST inputs and `Response` allowed as a return). Opt out with `createServerFn({ strict: false })`, `strict: { input: false }`, or `strict: { output: false }` — this relaxes only the *TypeScript* check, not runtime serialization.

### 2.3 Middleware and context

**[DOC — `guide/middleware.md`]** Two kinds:

| | Request middleware | Server-function middleware |
|---|---|---|
| Created with | `createMiddleware()` (default `type: 'request'`) | `createMiddleware({ type: 'function' })` |
| Methods | `.middleware()`, `.server()` | `.middleware()`, `.validator()`, `.client()`, `.server()` |
| Scope | All server requests (SSR, server routes, server fns) | Server functions only |

```tsx
// Auth as a reusable middleware factory
export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await auth.getSession({ headers: request.headers })
  if (!session) throw new Error('Unauthorized')
  return await next({ context: { session } })
})

export function authorizationMiddleware(permissions: Record<string, string[]>) {
  return createMiddleware({ type: 'function' })
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      if (!(await auth.hasPermission(context.session, permissions))) throw new Error('Forbidden')
      return await next()
    })
}
```

Global wiring in `src/start.ts` (file is **not** in the default template):

```tsx
// src/start.ts
import { createStart, createCsrfMiddleware } from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],   // every request: SSR + server routes + server fns
  functionMiddleware: [timingMiddleware], // every server function only
  defaultSsr: true,
}))
```

**Critical security note repeated throughout the docs:** *"Server functions are API endpoints reachable independently of whichever route renders the calling UI. Apply `authMiddleware` or an equivalent in-handler check to every server function that reads or writes private data. `beforeLoad` is useful route UX, but it is not the data boundary."*

Client-sent context is **not** sent to the server unless explicitly forwarded with `next({ sendContext: {...} })`, and it is **not runtime-validated** — validate it server-side and never derive the session from it.

### 2.4 Error handling

**[DOC]** `throw new Error(...)` is serialized to the client; `throw redirect({ to })` and `throw notFound()` are handled by the router.

**[VERIFIED-SOURCE — `server-functions-handler.ts`]** Two distinct failure channels with **different HTTP status codes**:

- An error **returned** through the pipeline (e.g. a validation failure) → server responds **HTTP 200** with the error inside the serialized envelope.
- An error **thrown** out of the handler boundary (e.g. body deserialization failure) → **HTTP 500** with a seroval-serialized error body.

### 2.5 The URL and the wire format — and why third parties cannot use it

#### URL

**[VERIFIED-SOURCE — `createClientRpc.ts`]**

```ts
export function createClientRpc(functionId: string) {
  const url = process.env.TSS_SERVER_FN_BASE + functionId
  ...
  return Object.assign(clientFn, { url, serverFnMeta, [TSS_SERVER_FUNCTION]: true })
}
```

**[VERIFIED-SOURCE — `start-plugin-core/src/planning.ts:85-90` and `schema.ts:249`]**

```ts
export function createServerFnBasePath(opts: { routerBasepath: string; serverFnBase: string }) {
  return joinPaths(['/', opts.routerBasepath, opts.serverFnBase, '/'])
}
// schema: serverFns.base default '/_serverFn'
```

So the URL is **`/_serverFn/<functionId>`** (configurable: `tanstackStart({ serverFns: { base: '/_fn' } })`).

**[VERIFIED-SOURCE — `createStartHandler.ts:175, 565-566, 668-673`]** Routing is purely path-based:

```ts
const SERVER_FN_BASE = process.env.TSS_SERVER_FN_BASE
const isServerFnRequest = !!SERVER_FN_BASE && url.pathname.startsWith(SERVER_FN_BASE)
// later:
const serverFnId = url.pathname.slice(SERVER_FN_BASE.length).split('/')[0]
```

#### Function IDs are build artefacts

**[VERIFIED-SOURCE — `start-compiler/compiler.ts:606-676`]**

- **Dev:** `base64url(JSON.stringify({ file, export }))` where file is the module path plus `?tss-serverfn-split` — the ID literally leaks the source path.
- **Production (default):** `crypto.createHash('sha256').update(`${filename}--${functionName}`).digest('hex')` — a 64-char hex digest.
- Collisions are de-duplicated by appending `_1`, `_2`, …
- `generateFunctionId` can override this, but **[DOC]** "this customization is **experimental** and subject to change."

Consequence: **IDs are not a stable public contract.** Renaming a file, moving it, or renaming the exported function changes the URL. The docs themselves say to "prefer deterministic inputs (filename + functionName) so IDs remain stable between builds" — which is advice for *your* rebuilds, not a compatibility guarantee for third parties.

#### The wire protocol — fully reverse-engineered and verified

**[VERIFIED-SOURCE — `start-client-core/src/client-rpc/serverFnFetcher.ts`]** Client behaviour:

- Header `x-tsr-serverFn: true` is always set.
- `accept: application/x-tss-framed, application/x-ndjson, application/json` (non-FormData).
- **GET:** payload moved into the query string as `?payload=<JSON>` using `encode()` from router-core.
- **POST:** body is `JSON.stringify(await toJSONAsync(payload, { plugins }))` with `content-type: application/json` — i.e. **seroval `toJSON`, not `toCrossJSON`**. If the payload is `FormData`, the FormData is sent as-is with context in a `__TSS_CONTEXT` field.
- Response handling keys off `x-tss-serialized: true`, and decodes either `application/json` via `fromCrossJSON`, or `application/x-tss-framed; v=1` via a binary frame decoder for `RawStream`s.

**[VERIFIED-SOURCE — `start-server-core/src/server-functions-handler.ts`]** Server behaviour, verbatim logic:

```ts
const isServerFn = request.headers.get('x-tsr-serverFn') === 'true'
...
} else if (methodUpper === 'GET') {
  const payloadParam = url.searchParams.get('payload')
  const payload = payloadParam ? fromJSON(JSON.parse(payloadParam), { plugins }) : {}
  ...
} else {
  const payload = contentType?.includes('application/json')
    ? fromJSON(await request.json(), { plugins })     // <-- seroval toJSON required
    : {}
  ...
}
if (!isServerFn) return unwrapped                        // raw object, not a Response
return serializeResult(res, request.signal, serovalPlugins)
```

#### Empirical results — the decisive evidence

I ran these against a real app. Command shapes are in §11.

| Request | Observed result |
|---|---|
| `GET /_serverFn/<id>` with **no** `Origin`/`Referer`/`Sec-Fetch-Site` (i.e. a server-side or non-browser third-party client) | **`403 Forbidden`**, `text/plain`. Body: `Forbidden` |
| `GET /_serverFn/<id>` with `Origin: https://static-blog.example` | **`403 Forbidden`** |
| `GET /_serverFn/<id>` with `Sec-Fetch-Site: same-origin`, **no** `x-tsr-serverFn` | **`500`** `{"status":500,"unhandled":true,"message":"HTTPError"}` |
| `GET /_serverFn/<id>` + `Sec-Fetch-Site: same-origin` + `x-tsr-serverFn: true` | **`200`**, `x-tss-serialized: true`, `content-type: application/json`, body:<br>`{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[…]},"o":0}` |
| `POST /_serverFn/<id>` with **plain JSON** `{"data":{"body":"hi"}}` | **`500`**, body `{"t":25,"i":0,"s":{"message":{"t":1,"s":"Seroval Error (step: 3)"}},"c":"$TSR/Error"}` |
| `POST /_serverFn/<id>` with correct seroval `toJSON` body `{"t":{…},"f":127,"m":[]}` + `x-tsr-serverFn: true` | **`200`**, success envelope |
| Same, but **zod validation fails** | **`200`** (not 4xx) with the zod issues inside the `error` field of the envelope |
| `GET /_serverFn/doesnotexist` | **`500`** (not 404) |

Isolated library check **[VERIFIED-RUNTIME]** on `seroval@1.6.7`:

```
fromJSON({data:{a:1}})                       -> throws SerovalUnsupportedNodeError (step: 3)
toCrossJSONAsync({data:{name:'John'}})       -> {"t":10,"i":0,"p":{"k":["data"],"v":[…]},"o":0}
toJSONAsync({data:{body:'hi'}})              -> {"t":{…},"f":127,"m":[]}
```

#### Verdict

**Server functions are not plain HTTP endpoints.** An external, non-TanStack client would have to:

1. Reproduce seroval's `toJSON` encoder byte-for-byte for the request body (an internal serialization format of a third-party library, with no compatibility statement, no version negotiation and no schema). Note the asymmetry: **requests use `toJSON`, responses use `toCrossJSON`** — an easy way to get it wrong, as I did on the first attempt.
2. Send `x-tsr-serverFn: true`.
3. Satisfy the CSRF check, which by default requires `Sec-Fetch-Site: same-origin` — a browser on a different origin *cannot* forge this, and server-to-server callers typically omit it and are rejected.
4. Know a 64-char SHA-256 ID derived from internal file paths, which is not a published API surface.
5. Parse a `{result, error, context}` envelope and inspect the HTTP-200 `error` field to detect failures.

**Use `createServerFn` for your own React app's RPC. Use server routes for every endpoint that a static blog, a mobile app, a webhook provider, or a curl script must call.** The docs say this explicitly:

> Server functions are meant to be called by your TanStack Start application. […] If you need an endpoint that can be called from outside your Start app, use **server routes** instead. — `guide/server-functions.md`

### 2.6 CSRF middleware — default behaviour

**[VERIFIED-SOURCE — `createStartHandler.ts:102-104, 588-595`]** This is the exact auto-install logic:

```ts
const defaultCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const requestStartOptions = {
  ...startOptions,
  requestMiddleware: startInstance
    ? startOptions.requestMiddleware                        // you own it
    : isServerFnRequest
      ? [defaultCsrfMiddleware]                            // auto-installed
      : undefined,
  ...
}
```

**Two consequences:**

1. If you do **not** create `src/start.ts`, server functions get CSRF protection automatically.
2. **If you *do* create `src/start.ts` — which you must for global middleware — you silently lose that protection unless you re-add `createCsrfMiddleware()` yourself.** A dev-only console warning fires in that case.

**[VERIFIED-SOURCE — `createCsrfMiddleware.ts:105-151`]** Validation order and defaults:

```ts
const fetchSite = ctx.request.headers.get('Sec-Fetch-Site')
if (fetchSite !== null) return matchValue(opts.secFetchSite ?? 'same-origin', fetchSite, ctx)

const origin = ctx.request.headers.get('Origin')
if (origin !== null) {
  if (opts.origin) return matchValue(opts.origin, origin, ctx)
  return origin === new URL(ctx.request.url).origin
}

const referer = ctx.request.headers.get('Referer')
if (referer === null || opts.referer === false) return undefined   // -> rejected
...
```

Failure response default: `new Response('Forbidden', { status: 403 })`. Opt out of the origin requirement (only if another layer guarantees same-origin) with `allowRequestsWithoutOriginCheck: true`.

> **Note:** the CSRF middleware guards **server functions only** by default (`filter: ctx => ctx.handlerType === 'serverFn'`). **Server routes are not CSRF-protected.** If your comment system has cookie-authenticated write endpoints implemented as server routes, *you* must implement CSRF protection there. **[VERIFIED-RUNTIME: a cross-origin `POST` with `Origin: https://static-blog.example` to a server route returned `201` with `Access-Control-Allow-Origin: *`.]**

---

## 3. Plain REST API routes (server routes)

### 3.1 The file convention — `createServerFileRoute` is GONE

**This is the single biggest RC→v1 API change for a backend.** `createServerFileRoute('/api/x').methods({...})` no longer exists anywhere — not in docs, not as an export in any package. The only surviving references are stale test *names* in `packages/start-server-core/tests/serverRoute.test-d.ts`. **[VERIFIED-SOURCE]**

The current API puts a `server` property on a normal `createFileRoute` call **[DOC — `guide/server-routes.md`]**:

```ts
// src/routes/api/comments.ts  ->  endpoint at /api/comments
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/comments')({
  server: {
    handlers: {
      GET: async ({ request, params, context }) => {
        return new Response('Hello, World!')
      },
    },
  },
})
```

**Path conventions [DOC]** — identical to the router's file-based routing:

| File | Endpoint |
|---|---|
| `routes/users.ts` | `/users` |
| `routes/users/index.ts` | `/users` |
| `routes/users/$id.ts` | `/users/$id` (param `id`) |
| `routes/users/$id/posts.ts` | `/users/$id/posts` |
| `routes/file/$.ts` | `/file/*` (param `_splat`) |
| `routes/my-script[.]js.ts` | `/my-script.js` (escaped `.`) |

Two files resolving to the same path **error at startup**. A page route and a server route may share one file — define both `server.handlers` and `component`.

### 3.2 Handlers, middleware, and the handler context

**[DOC]** Two forms. Simple:

```ts
server: {
  middleware: [loggerMiddleware],       // applies to ALL handlers on this route
  handlers: {
    GET: async ({ request }) => new Response('ok'),
    POST: async ({ request }) => { const body = await request.json(); /* … */ },
  },
}
```

Per-handler middleware via `createHandlers`:

```ts
server: {
  middleware: [authMiddleware],          // runs first for all handlers
  handlers: ({ createHandlers }) =>
    createHandlers({
      GET: async ({ request }) => new Response('ok'),
      POST: {
        middleware: [validationMiddleware],   // then this, POST only
        handler: async ({ request }) => { /* … */ },
      },
    }),
}
```

Handler context: `{ request, params, context }` where `request` is a standard web `Request` and `params` holds dynamic path params. Return a `Response` (or `Promise<Response>`).

**[VERIFIED-SOURCE — `createStartHandler.ts:969-975`]** Method dispatch, verbatim:

```ts
const requestMethod = request.method.toUpperCase() as RouteMethod
// Per RFC 9110 §9.3.2, HEAD must return the same header fields as GET.
// Priority for HEAD: explicit HEAD handler → GET → ANY (last resort).
const handler =
  requestMethod === 'HEAD'
    ? (handlers['HEAD'] ?? handlers['GET'] ?? handlers['ANY'])
    : (handlers[requestMethod] ?? handlers['ANY'])
```

So valid keys are `GET HEAD POST PUT PATCH DELETE OPTIONS` plus the **`ANY` catch-all**. **[VERIFIED-SOURCE — `start-client-core/src/serverRoute.ts:291, 429`]**

### 3.3 Reading the request

**[DOC + VERIFIED-RUNTIME]** Everything is plain web-standard:

```ts
// JSON body
POST: async ({ request }) => { const body = await request.json() }

// Query params
GET: async ({ request }) => {
  const url = new URL(request.url)
  const postId = url.searchParams.get('postId')
  const limit = Number(url.searchParams.get('limit') ?? 20)
}

// Headers
GET: async ({ request }) => request.headers.get('authorization')

// Dynamic params
GET: async ({ params }) => params.id
```

Also available: `request.text()`, `request.formData()`, `request.arrayBuffer()`.

### 3.4 Returning responses

```ts
// JSON with the static helper (sets Content-Type automatically)
return Response.json({ comments })

// Status code + headers
return new Response('User not found', { status: 404 })

return Response.json(
  { error: 'Rate limited' },
  { status: 429, headers: { 'Retry-After': '60' } },
)

// 204 with a custom header
return new Response(null, { status: 204, headers: { 'X-Deleted': id } })
```

### 3.5 A complete, verified comment-API route

This exact code was built and exercised in dev **and** in a production Node/Nitro build.

```ts
// src/routes/api/comments.ts
import { createFileRoute } from '@tanstack/react-router'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export const Route = createFileRoute('/api/comments')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const url = new URL(request.url)
        const postId = url.searchParams.get('postId')
        // const comments = await db.select().from(commentsTable).where(eq(commentsTable.postId, postId))
        const comments: unknown[] = []
        return Response.json(
          { postId, comments },
          { status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' } },
        )
      },

      POST: async ({ request }) => {
        const body = await request.json()
        // validate with zod, insert with Drizzle, etc.
        return Response.json({ created: body }, { status: 201, headers: CORS })
      },
    },
  },
})
```

**[VERIFIED-RUNTIME] observed responses:**

```
GET  /api/comments?postId=42   -> 200  {"postId":"42","comments":[]}
                                  headers: access-control-allow-origin: *, access-control-allow-methods: GET, POST, OPTIONS,
                                           access-control-allow-headers: Content-Type, Authorization, cache-control: no-store,
                                           x-custom: yes, content-type: application/json
POST /api/comments             -> 201  {"created":{"body":"hi"}}
DELETE /api/items/123          -> 204  x-deleted: 123
GET  /api/echo.json?q=hello    -> 200  {"q":"hello","path":"/api/echo.json","ua":"curl/8.22.0"}
```

### 3.6 ⚠️ Unmatched methods do NOT return 405

**[VERIFIED-RUNTIME, dev AND production]** A request with a method the route does not define **falls through to the SSR app router** and returns the HTML shell:

```
PUT /api/items/123   ->  status=200  content-type=text/html; charset=utf-8   (the app shell)
OPTIONS /api/echo.json (no OPTIONS handler) -> 200 text/html
```

This is because `terminalHandler` stays `executeRouter` when no handler matches. **Implication for a public API:** a client that sends a wrong method gets a `200` HTML page instead of a `405`. If that matters, define an `ANY` handler that returns 405 with an `Allow` header, or add a global request middleware.

*(For contrast, server functions **do** return 405 for a method mismatch — `server-functions-handler.ts` returns `405` with an `Allow` header. Server routes do not.)*

---

## 4. CORS

### 4.1 There is no built-in CORS support

**[VERIFIED-SOURCE]** A case-insensitive grep for `cors` / `access-control` across `packages/*/src` returns **nothing**. A grep across all of `docs/start/**` returns one unrelated hit. There is no `cors` plugin option, no helper, no default header injection.

You do it manually. Two verified approaches.

### 4.2 Per-route (recommended for a public comment API)

Put the headers on each `Response` (see §3.5) **and define an explicit `OPTIONS` handler.**

### 4.3 Global, via request middleware

**[VERIFIED-SOURCE — `createMiddleware.ts:822-834`]** The `next()` result for a request middleware is `{ request, pathname, context, response: Response }`, so a global middleware can rewrite the response:

```ts
// src/start.ts
import { createStart, createMiddleware } from '@tanstack/react-start'

const PUBLIC_API = /^\/api\//
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

const corsMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url)

  // Answer preflight ourselves so no per-route OPTIONS handler is needed.
  if (request.method === 'OPTIONS' && PUBLIC_API.test(url.pathname)) {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const result = await next()
  if (PUBLIC_API.test(url.pathname)) {
    const headers = new Headers(result.response.headers)
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
    return new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    })
  }
  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [corsMiddleware],
}))
```

**Caveats on the global approach:**
- Returning a bare `204` from the middleware **bypasses your route handlers entirely** — verified that this works because `executeMiddleware` short-circuits when a middleware does not call `next()`.
- Re-wrapping `result.response.body` in a new `Response` is fine for ordinary bodies but **will not preserve streaming semantics for SSE** — for streamed endpoints set the headers on the returned `Response` in the handler instead. **[INFERENCE from the Response re-construction, not separately tested.]**
- Because installing `src/start.ts` disables the auto-CSRF middleware, remember to add `createCsrfMiddleware(...)` back if you use server functions. (Your `corsMiddleware` is a request middleware, so it runs for **every** request including SSR and server functions — scope it with the pathname regex as above.)

### 4.4 The OPTIONS trap — verified behaviour, and a dev/prod difference

| Scenario | dev (`vite dev`) | production (`node .output/server/index.mjs`) |
|---|---|---|
| `OPTIONS` on a route **with** an `OPTIONS` handler | **Your handler is bypassed.** Responds `204` with `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`, `Access-Control-Allow-Headers: content-type`, and **no `Access-Control-Allow-Origin`** | **Your handler runs.** `204` with exactly your headers, including `access-control-allow-origin: *` |
| `OPTIONS` on a route **without** an `OPTIONS` handler | `204` from the dev server | **`200 text/html`** — the SSR app shell, with no CORS headers → **preflight fails** |

**[VERIFIED-RUNTIME]** Root cause: Vite's dev server answers `OPTIONS` itself; Nitro/srvx in production does not. Also note the dev-only `Vary: Origin` header that disappears in production.

**Practical guidance:**
1. Always define `OPTIONS` explicitly (or a global preflight middleware). Do not rely on dev-server behaviour.
2. **Always test preflight against a production build** — dev lies to you here.
3. Watch for one more trap: because the server route handler context runs through the same middleware pipeline as SSR, a preflight that reaches the router path is subject to the `Accept` content-negotiation guard and the app shell.
4. A cross-origin **non-preflighted** request (simple POST) to a server route with explicit CORS headers **is accepted** — verified `201` with `Origin: https://static-blog.example`. Server routes are genuinely open by default; the framework does not stand in your way, and does not protect you either.

---

## 5. SSR, streaming, selective SSR, and rendering a comment list for SEO

### 5.1 Loaders run on BOTH server and client

**[DOC — `guide/execution-model.md`]** This is the most commonly misunderstood part:

> **All code in TanStack Start is isomorphic by default** … **Critical Understanding**: Route `loader`s are isomorphic - they run on both server and client, not just the server.

Therefore a secret read inside a loader leaks to the client, and a loader that calls a database directly will break on client navigation:

```tsx
// ❌ WRONG — runs on the client during navigation, leaks process.env, breaks bundling
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    return db.select().from(comments).where(eq(comments.postId, params.postId))
  },
})

// ✅ RIGHT — server function called from an isomorphic loader
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => getComments({ data: { postId: params.postId } }),
})
```

**[VERIFIED-RUNTIME]** The SSR HTML of my page route already contained the rendered markup:

```html
<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>verify</title>…</head>
<body><!--$--><h1>hello ssr</h1><script>…hydration data…</script>…</body></html>
```

### 5.2 SEO surface — `head()` driven by loader data

**[DOC — `guide/seo.md`]** This is the canonical SSR comment-list pattern:

```tsx
// src/routes/posts/$postId.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getComments } from '~/server/comments.functions'

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    const post = await fetchPost(params.postId)
    const comments = await getComments({ data: { postId: params.postId } })
    return { post, comments }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData.post.title },
      { name: 'description', content: loaderData.post.excerpt },
      { property: 'og:title', content: loaderData.post.title },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'canonical', href: `https://myapp.com/posts/${loaderData.post.id}` }],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: loaderData.post.title,
        }),
      },
    ],
  }),
  component: PostPage,
})

function PostPage() {
  const { post, comments } = Route.useLoaderData()
  return (
    <article>
      <h1>{post.title}</h1>
      <ul>{comments.map((c) => <li key={c.id}>{c.body}</li>)}</ul>
    </article>
  )
}
```

`head()` returns `{ title, meta, links, styles, scripts }`; the router **dedupes `title`/`meta`, preferring the last (deepest) occurrence**. Body scripts use a separate **top-level** route option `scripts: () => [...]`, not `head`.

**Hard requirement:** `<HeadContent />` must be inside `<head>` and `<Scripts />` inside `<body>` of the root route, or **the page cannot hydrate**.

**Sitemap / robots [DOC]:** `tanstackStart({ sitemap: { enabled: true, host: 'https://myapp.com' } })` generates a sitemap at build time by crawling routes. Only `enabled` and `host` are documented. Dynamic `robots.txt` / `sitemap.xml` are just server routes named `robots[.]txt.ts` and `sitemap[.]xml.ts`.

### 5.3 Selective SSR

**[DOC — `guide/selective-ssr.md`]** Per-route `ssr` option, default `true`:

| Value | `beforeLoad` on server | `loader` on server | Component SSRed | SEO impact |
|---|---|---|---|---|
| `true` (default) | ✅ (context sent to client) | ✅ (data sent to client) | ✅ | best |
| `'data-only'` | ✅ | ✅ | ❌ (client-rendered) | `head()`/meta still resolve on server |
| `false` | ❌ | ❌ | ❌ | crawlers see only the pending fallback |

```tsx
// Static
export const Route = createFileRoute('/dashboard')({
  ssr: false,           // or 'data-only'
  component: DashboardPage,
})

// Functional — runs ONLY on the server during the initial request and is
// stripped from the client bundle. params/search arrive as discriminated unions.
export const Route = createFileRoute('/docs/$docType/$docId')({
  validateSearch: z.object({ details: z.boolean().optional() }),
  ssr: ({ params, search }) => {
    if (params.status === 'success' && params.value.docType === 'sheet') return false
    if (search.status === 'success' && search.value.details) return 'data-only'
  },
  // params: { status: 'success'; value: T } | { status: 'error'; error: unknown }
})
```

Global default: `createStart(() => ({ defaultSsr: false }))` in `src/start.ts`.

**Inheritance is monotonic** — a child can only become *more* restrictive: `true` → `'data-only'` → `false`. A child `ssr: true` under a parent `ssr: false` has **no effect**. Fallback for the first non-SSR route is its `pendingComponent`, else `defaultPendingComponent`, else nothing.

**Root route caveat:** you can set `ssr: false` on the root route, but the `<html>` shell is still server-rendered via `shellComponent` (which is *always* SSRed and wraps `component`, `errorComponent` or `notFoundComponent`).

### 5.4 Streaming

**[DOC]** Two independent mechanisms.

**Deferred loader data** — return an unawaited promise from the loader and render it with `<Await>`:

```tsx
loader: async () => ({
  fastData: await fetchFastData(),
  deferredSlowData: fetchSlowData(),        // NOT awaited
})

<Await promise={deferredSlowData} fallback={<div>Loading…</div>}>
  {(data) => <div>{data}</div>}
</Await>
```

`defer()` still exists but is no longer needed: *"You don't need to call `defer` manually anymore, Promises are handled automatically now."*

**Streaming from server functions** [DOC] — typed `ReadableStream`, or the cleaner async-generator form:

```ts
const streamComments = createServerFn().handler(async function* () {
  for (const c of await loadNewComments()) {
    yield c        // typed chunks
  }
})

// client:
for await (const chunk of await streamComments()) { /* … */ }
```

**[VERIFIED-SOURCE — `constants.ts`]** The transport is `application/x-tss-framed; v=1` with a 9-byte binary frame header, `MAX_FRAME_PAYLOAD_SIZE = 16 MiB`, `MAX_FRAMED_STREAMS = 1024`, `MAX_UNREAD_RAW_STREAM_BYTES = 128 MiB`.

**SSR streaming** is automatic with the default `defaultStreamHandler`; it requires `<Scripts />` in `<body>`.

### 5.5 Static prerendering and "ISR"

**[DOC]** `tanstackStart({ prerender: { enabled: true, crawlLinks: true, concurrency: 14, filter, failOnError, … }, pages: [{ path: '/p', prerender: { enabled: true, outputPath } }] })`. Auto-discovery skips routes with path params, layout routes (`_` prefix), and routes without components.

**"ISR" is not a framework primitive** — it is prerendering + `Cache-Control` + CDN behaviour. Page routes set headers with a route-level `headers()` option:

```tsx
export const Route = createFileRoute('/blog/$slug')({
  headers: () => ({
    'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
  }),
})
```

> ⚠️ **Doc bug [VERIFIED-SOURCE]:** `guide/isr.md` shows `prerender: { routes: ['/blog', '/blog/posts/*'] }` twice. **There is no `routes` key in the plugin schema** — the zod object is not `.strict()`, so it is silently stripped and does nothing. Use the top-level `pages: [{ path, prerender }]` array.

### 5.6 SPA mode, for completeness

`tanstackStart({ spa: { enabled: true } })` prerenders **the root route only**, writing a shell (default `/_shell.html`) and rewriting 404s to it. Loaders/`beforeLoad` never run on the server at runtime. Server functions and server routes still work **only if the host rewrites those subpaths through to a server**, e.g.:

```
/_serverFn/* /_serverFn/:splat 200
/api/*       /api/:splat       200
/*           /_shell.html      200
```

---

## 6. Deployment targets

### 6.1 Build model

**[DOC + VERIFIED-RUNTIME]** `vite build` (or `rsbuild build`) produces a client bundle plus a **server bundle that exports a WinterCG fetch handler**:

```ts
type ServerEntry = { fetch(request: Request): Response | Promise<Response> }
```

The source of that contract is `src/server.ts` (optional):

```ts
// src/server.ts
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
```

Everything else — long-running Node, Workers, Bun, Netlify, Vercel — is an adapter around that function.

**There is no `target` option in the `tanstackStart()` Vite plugin. [VERIFIED-SOURCE — `start-plugin-core/src/schema.ts`]** All provider-specific behaviour comes from a **third-party plugin** (`@cloudflare/vite-plugin`, `@netlify/vite-plugin-tanstack-start`, `nitro/vite`). The full plugin option surface is: `srcDirectory`, `start.entry`, `router.{entry,basepath}`, `client.{entry,base}`, `server.{entry,build.{staticNodeEnv,inlineCss}}`, `serverFns.{base,disableCsrfMiddlewareWarning,generateFunctionId}`, `pages`, `sitemap`, `prerender`, `dev.ssrStyles`, `spa`, `importProtection`.

### 6.2 Node.js / Docker — VERIFIED END TO END

**[VERIFIED-RUNTIME]** With `nitro()` in the Vite plugin array:

```
$ npx vite build
$ ls .output/server/
_chunks/  _libs/  _runtime.mjs  _ssr/
index.mjs                        # <-- entry
_tanstack-start-manifest_v-*.mjs

$ PORT=3222 node .output/server/index.mjs
# served HTTP 200 on / immediately
```

`package.json` scripts (from the official example):

```json
"build": "vite build && tsc --noEmit",
"start": "node .output/server/index.mjs"
```

**A plain `Dockerfile` is trivially:**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

**[INFERENCE — the docs section is titled "Node.js / Docker" but contains no Dockerfile; the above is my construction from the verified build output.]**

**Rsbuild alternative [DOC]** — emits `dist/client` + `dist/server/index.js` (sometimes `dist/server/server.js`) exporting the fetch entry. Serve it with `srvx`:

```json
"build": "rsbuild build",
"start": "srvx --prod -s ../client dist/server/index.js"
```

> "Express or any other custom Node.js server works too, as long as it serves the client assets and calls the server entry's `fetch` handler for dynamic requests."

**Performance tip [DOC]:** on Node/Nitro/srvx you can gain ~5% throughput by replacing the global `Response`:

```ts
// src/server.ts (first lines)
import { FastResponse } from 'srvx'
globalThis.Response = FastResponse
```

### 6.3 Cloudflare Workers ⭐ official partner

```ts
// vite.config.ts
import { cloudflare } from '@cloudflare/vite-plugin'
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), viteReact()],
})
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tanstack-start-app",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry"
}
```

**Constraints [DOC]:**
- `nodejs_compat` is required for Node built-ins.
- **Env vars are injected per-request.** Module-scope `process.env.X` evaluates to `undefined` *and* risks inlining secrets into the client bundle. Read them inside `.handler()`, middleware `.server()`, or server-route handlers — or use the `cloudflare:workers` env binding.
- No filesystem. No long-lived process. `setInterval` at module scope is not a thing (use Cron Triggers — see §9).

### 6.4 Netlify ⭐ official partner

```ts
import netlify from '@netlify/vite-plugin-tanstack-start'
export default defineConfig({ plugins: [tanstackStart(), netlify(), viteReact()] })
```

Manual `netlify.toml`: `command = "vite build"`, `publish = "dist/client"`.

### 6.5 Vercel

**[DOC]** *"Follow the Nitro deployment instructions. Deploy your application to Vercel using their one-click deployment process."* That is the entire Vercel section — no Vercel config file, no preset name, no limitations documented. Nitro is flagged: *"still under active development and receives regular updates."* **[UNVERIFIED — I did not test a Vercel deploy.]**

### 6.6 Railway ⭐ official partner

Deploy via Nitro; Railway auto-detects build settings, provides Postgres/MySQL/Redis/MongoDB and preview environments.

### 6.7 Bun

**[DOC]** *"Currently, the Bun specific deployment guidelines only work with React 19."* Use `nitro({ preset: 'bun' })`, or copy the reference `server.ts` from `examples/react/start-bun/server.ts` and run `bun run server.ts`. That reference implementation serves static assets with Bun-native file handling, preloads small assets into memory (`ASSET_PRELOAD_MAX_SIZE`, default 5 MB), and supports gzip + ETag.

### 6.8 Appwrite Sites

Build `npm run build`, output `./dist` (or `./.output` for Nitro v2/v3).

### 6.9 Not documented

**AWS Lambda is not mentioned anywhere. Deno is not mentioned. Docker has a heading but no instructions. [VERIFIED-SOURCE — full read of `guide/hosting.md`]** Generic "edge" is reachable only through Cloudflare Workers or a Nitro preset.

### 6.10 Node vs edge — practical limitation matrix for a comment backend

| Capability | Long-running Node/Docker | Cloudflare Workers | Notes |
|---|---|---|---|
| SQLite via `better-sqlite3` | ✅ | ❌ | native addon; no FS on edge |
| libSQL / Turso | ✅ | ✅ | HTTP-based, edge-friendly |
| Postgres via `pg` (TCP pool) | ✅ | ❌ / ⚠️ | needs Hyperdrive or a serverless driver |
| Postgres via Neon/`@neondatabase/serverless` (HTTP) | ✅ | ✅ | |
| In-process cache (`Map`, LRU) | ✅ | ❌ | per-isolate, evicted |
| Module-scope `setInterval` | ✅ | ❌ | |
| Long-running background task | ✅ | ❌ | Workers have CPU/wall limits |
| SSE | ✅ **[VERIFIED]** | ✅ | streamed `Response` |
| WebSocket | ⚠️ via external server | ✅ via Durable Objects | not provided by Start |
| `process.env` at module scope | ✅ | ❌ | read per-request |

---

## 7. Database integration (Drizzle + SQLite/Postgres)

### 7.1 What the docs actually give you — almost nothing

**[VERIFIED-SOURCE]** `guide/databases.md` is **109 lines** and contains exactly one code block, with an **undefined placeholder**:

```tsx
import { createServerFn } from '@tanstack/react-start'

const db = createMyDatabaseClient()      // <- never defined anywhere

export const getUser = createServerFn().handler(async ({ context }) => {
  const user = await db.getUser(context.userId)
  return user
})
```

Closing line: *"Documentation for integrating different databases with TanStack Start is coming soon!"* The page is otherwise sponsor copy for Neon, Convex and Prisma Postgres.

**[VERIFIED-SOURCE — grep over all of `docs/**/*.md`]** **Zero** hits for: `drizzle`, `drizzle-kit`, `drizzle.config`, `kysely`, `better-sqlite3`, `libsql`, `mysql2`, `postgres` (as a package), `prisma migrate`, `prisma generate`, or any ORM client construction. The string `@prisma/client` appears only as an *import-protection deny-rule example*. The only "migration" mention is a production-checklist line: *"account for any database migration separately."*

**You are on your own for ORM setup and migrations.** What the framework *does* give you is a robust mechanism for keeping DB code off the client, and a file-layout convention.

### 7.2 The isolation model (this part is genuinely good)

Three layers, all documented:

**Layer 1 — filename convention + import protection.** `*.server.*` files are denied in the client environment and `*.client.*` in the server; the specifier `@tanstack/react-start/server` is denied on the client. Violation is a **build error** in production, a warning + proxy mock in dev.

```ts
// vite.config.ts — belt-and-braces for a DB layer
tanstackStart({
  importProtection: {
    client: {
      specifiers: ['@prisma/client', 'bcrypt', 'better-sqlite3'],
      files: ['**/db/**'],
    },
  },
})
```

Or a side-effect marker in a file whose name doesn't end in `.server.ts`:

```ts
// src/db/client.ts
import '@tanstack/react-start/server-only'

import { drizzle } from 'drizzle-orm/better-sqlite3'
...
```

*"If both markers appear in the same file it is always an error."* Type-only imports are ignored.

**Layer 2 — `createServerOnlyFn`.** Compiles to a throwing stub on the client:

```ts
import { createServerOnlyFn } from '@tanstack/react-start'

export const getEnvVar = createServerOnlyFn(() => process.env.DATABASE_URL)
// client: throws "createServerOnlyFn() functions can only be called on the server!"
```

**Layer 3 — the documented file layout [DOC — `server-functions.md`]:**

```
src/utils/
├── users.functions.ts   # createServerFn wrappers — safe to import anywhere
├── users.server.ts      # server-only: DB queries. Import ONLY inside server fns
└── schemas.ts           # shared zod schemas — client-safe
```

> ⚠️ **The documented footgun:** an import "stays alive" in the client bundle if a server-only symbol is referenced outside a server boundary.

```ts
import { getUsers } from './db/queries.server'
import { createServerFn } from '@tanstack/react-start'

export const fetchUsers = createServerFn().handler(async () => getUsers())  // ✅ removed for client

export function leakyHelper() { return getUsers() }                          // ❌ keeps the import alive
```

Barrel files are a classic leak: `export { fetchUsers } from './fetchUsers'` in the same `index.ts` as `export { getDb } from './db.server'` still routes the client through the module graph.

### 7.3 A concrete Drizzle setup consistent with the above

> **[INFERENCE / NOT IN DOCS]** The docs do not show Drizzle. The following follows the documented isolation model and standard Drizzle APIs; I did not run it against a live database. Treat it as a design recommendation, not a verified snippet.

**SQLite (better-sqlite3) — long-running Node only:**

```ts
// src/db/client.server.ts
import '@tanstack/react-start/server-only'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// Module-scope singleton is OK HERE because Node/Docker is a long-running process
// and this file is guaranteed server-only. On Cloudflare Workers this pattern is wrong.
const sqlite = new Database(process.env.DATABASE_FILE ?? './data/comments.db')
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
```

**libSQL / Turso — works on both Node and edge:**

```ts
// src/db/client.server.ts
import '@tanstack/react-start/server-only'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

// Per-request client, because env is injected per-request on edge runtimes.
export function getDb() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
  return drizzle(client, { schema })
}
```

**Postgres — pooled, per-request on edge:**

```ts
// src/db/client.server.ts
import '@tanstack/react-start/server-only'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

// Long-running Node: one pool at module scope is correct and desirable.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
export const db = drizzle(pool, { schema })
```

```ts
// src/db/schema.ts  — client-safe (types only)
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().index(),
  author: text('author').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
})
```

**Query layer + server function:**

```ts
// src/server/comments.server.ts
import '@tanstack/react-start/server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/db/client.server'
import { comments } from '~/db/schema'

export async function listApproved(postId: string, limit = 50) {
  return db.select().from(comments)
    .where(and(eq(comments.postId, postId), eq(comments.approved, true)))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
}

export async function insertComment(input: { postId: string; author: string; body: string }) {
  const [row] = await db.insert(comments)
    .values({ id: crypto.randomUUID(), createdAt: new Date(), approved: false, ...input })
    .returning()
  return row
}
```

```ts
// src/server/comments.functions.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { listApproved, insertComment } from './comments.server'

export const getComments = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string().min(1) }))
  .handler(async ({ data }) => listApproved(data.postId))

export const postComment = createServerFn({ method: 'POST' })
  .validator(z.object({
    postId: z.string().min(1),
    author: z.string().min(1).max(80),
    body: z.string().min(1).max(5000),
  }))
  .handler(async ({ data }) => insertComment(data))
```

### 7.4 Migrations

**Not documented by TanStack at all. [VERIFIED-SOURCE]** The workflow is entirely your ORM's:

- **Drizzle:** `drizzle.config.ts` pointing at `src/db/schema.ts` and `out: './drizzle'`; `drizzle-kit generate` in dev to produce SQL migrations, `drizzle-kit migrate` (or `drizzle-kit push` for prototypes) to apply. Run migrations as a **separate deploy step / init container**, never at app boot — Start gives you no lifecycle hook for this, and on serverless/edge there is no "boot" at all.
- **SQLite in Docker:** put the database file on a **volume**, not in the image layer. `better-sqlite3` is a native addon, so it must be compiled for the runtime image (`npm ci` inside the build stage solves this).
- **Connection pooling [DOC]:** the only guidance in the entire docs set is a single production-checklist line: *"Database URLs use connection pooling in production"*, plus Neon's "Built-in connection pooling" bullet. On serverless/edge you need an HTTP-based or pooler-fronted driver; a raw TCP `pg.Pool` per isolate will exhaust connections.

---

## 8. Auth and session patterns

### 8.1 What exists

**[VERIFIED-SOURCE — `start-server-core/src/request-response.ts`]** The server helper module is h3-backed and exports more than the docs admit:

| Function | Documented? | Notes |
|---|---|---|
| `getRequest()`, `getRequestHeader()`, `getRequestHeaders()` | ✅ | |
| `getRequestIP()`, `getRequestHost()`, `getRequestUrl()`, `getRequestProtocol()` | ❌ | exists |
| `setResponseHeader()`, `setResponseHeaders()`, `getResponseHeader()`, `removeResponseHeader()`, `clearResponseHeaders()` | ✅ (partial) | |
| `getResponseStatus()`, `setResponseStatus()`, `getResponse()` | ✅ (partial) | |
| `getCookie()`, `getCookies()`, `setCookie()`, `deleteCookie()` | ✅ (partial) | h3/cookie-es |
| **`useSession()`, `getSession()`, `updateSession()`, `clearSession()`, `sealSession()`, `unsealSession()`** | **only `useSession` is documented** | all present |
| `getValidatedQuery()` | ❌ | marked `// not public API (yet)` |

Both `getSession` and `deleteCookie` are **real and exported**, contradicting the docs (which only show `useSession` and a raw `Set-Cookie; Max-Age=0` technique). **[VERIFIED-SOURCE]** `session.ts` in `start-server-core` is only a *type* file (`SessionConfig`, `SessionManager`, `Session`) with a `// TODO discuss do we want to copy this interface into Start as well?` comment — the implementation is `h3_useSession` etc. from `h3-v2` (npm alias for `h3@2.0.1-rc.20`).

### 8.2 Cookie-based session (documented)

**[DOC — `guide/authentication.md`]** (`useSession` is async, so it lives inside server functions / middleware / server routes):

```ts
// src/server/session.ts
import { useSession } from '@tanstack/react-start/server'

type SessionData = { userId?: string; role?: 'admin' | 'user' }

export function useAppSession() {
  return useSession<SessionData>({
    name: 'app-session',
    password: process.env.SESSION_SECRET!,   // >= 32 chars, read per-request not at module scope
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60,
    },
  })
}
```

```ts
// Usage inside a server function
const session = await useAppSession()
if (!session.data.userId) throw new Error('Unauthorized')
await session.update({ userId: user.id })
await session.clear()
```

**`SessionConfig` [VERIFIED-SOURCE]:** `{ password, maxAge?, name? (default 'start'), cookie?: false | CookieSerializeOptions, sessionHeader?: false | string (default x-start-session / x-{name}-session), seal?, crypto?, generateId? }`. The session is **sealed (encrypted+signed) by h3** using `password`, so the cookie is self-contained and stateless — meaning **you cannot revoke a session server-side without a DB denylist**. For a comment system with moderation, prefer an opaque session ID + DB lookup.

### 8.3 Auth middleware protecting admin routes

**[DOC — `authentication-server-primitives.md`]** The docs are emphatic that route guards are **not** the data boundary:

```ts
// src/server/auth-middleware.ts
import { createMiddleware } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

export const adminMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const token = getCookie('__Host-session')
    const session = token ? await db.sessions.findValid(token) : null
    if (!session) throw new Error('Unauthorized')
    if (session.role !== 'admin') throw new Error('Forbidden')
    return next({ context: { session } })
  },
)
```

```ts
// applied to the endpoint itself, not just the route
export const deleteComment = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => db.comments.delete(data.id))
```

Route-level UX guard (defence in depth, still required for the UI):

```tsx
// src/routes/_authed/admin/index.tsx  (pathless layout route)
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/admin/')({
  beforeLoad: async ({ context, location }) => {
    if (!context.user) throw redirect({ to: '/login', search: { redirect: location.href } })
    if (context.user.role !== 'admin') throw redirect({ to: '/unauthorized' })
  },
})
```

The docs' own production checklist item: *"Test endpoints directly. Record a private read and write, then repeat them while signed out and as a different account. Both must reject unauthorized access without changing data. **A redirect in `beforeLoad` does not protect a separately callable endpoint.**"*

### 8.4 Raw cookie primitives, for a DB-backed session

**[DOC]** Nice detail the docs get right — split on the **first** `=` only, because signed/base64 values contain `=`:

```ts
const SESSION_COOKIE = '__Host-session'

export function setSessionCookie(token: string) {
  setResponseHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${token}`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${60 * 60 * 24}`,
  ].join('; '))
}

export function readSessionToken(): string | null {
  const header = getRequestHeader('cookie')
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')          // first '=' only
    if (eq === -1) continue
    if (part.slice(0, eq) === SESSION_COOKIE) return part.slice(eq + 1)
  }
  return null
}
```

`__Host-` prefix guidance is documented: requires `Secure`, `Path=/`, no `Domain`, and defeats subdomain-takeover session fixation.

### 8.5 What you must build yourself

**[VERIFIED-SOURCE]** There is **no** built-in: CSRF token helper (only origin-check middleware), rate limiter, password hashing, OAuth client, email verification, RBAC, or session denylist. The docs link provider examples (Clerk, WorkOS, Supabase, Better Auth, Auth.js, Auth0) and a DIY Prisma example (`examples/react/start-basic-auth`).

---

## 9. Background work, cron, queues, SSE, WebSocket

### 9.1 What the framework provides: nothing

**[VERIFIED-SOURCE]** No scheduler, no job runner, no queue abstraction, no `waitUntil`, no `ctx` for deferred work anywhere in `packages/*/src`. Background execution is entirely a property of the **host runtime**.

### 9.2 Per-target capabilities

| Target | Cron / scheduled | Long-running / fire-and-forget | Queue |
|---|---|---|---|
| **Long-running Node (Nitro/srvx, Docker)** | `setInterval`/`setTimeout` at module scope, or a system cron hitting an authenticated server route | ✅ module-scope timers persist | none built in; use BullMQ/pg-boss against Redis/Postgres |
| **Cloudflare Workers** | Cron Triggers via a `scheduled` handler exported from `src/server.ts` | ❌ (no long-lived task; `waitUntil` is Workers-specific) | Cloudflare Queues via a `queue` handler |
| **Netlify / Vercel / serverless** | platform cron (e.g. Vercel Cron) hitting a server route | ❌ | platform-specific |
| **Bun** | same as Node | ✅ | none built in |

**[DOC — `guide/server-entry-point.md`]:** *"When deploying to Cloudflare Workers, you can extend `server.ts` to handle additional Workers features like queues, scheduled events, and Durable Objects."* The doc links to the Cloudflare guide; the concrete shape is a Workers module exporting `fetch`, `scheduled`, `queue` — Start's `createServerEntry` composes with that by adding sibling exports. **[INFERENCE — the exact `scheduled` handler wiring for TanStack Start is described in Cloudflare's docs, not in TanStack's; I did not execute it.]**

**Recommended shape for a comment system on Node/Docker** — a cron-like moderation/cleanup job as a protected server route plus a system cron / container sidecar:

```ts
// src/routes/api/internal/purge-spam.ts
import { createFileRoute } from '@tanstack/react-router'
import { purgeSpam } from '~/server/comments.server'

export const Route = createFileRoute('/api/internal/purge-spam')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization')
        if (auth !== `Bearer ${process.env.INTERNAL_JOB_TOKEN}`) {
          return new Response('Unauthorized', { status: 401 })
        }
        const removed = await purgeSpam()
        return Response.json({ ok: true, removed })
      },
    },
  },
})
```

**Never** fire-and-forget a database write from a request handler on a serverless/edge target — the isolate is torn down when the response is returned.

### 9.3 SSE — VERIFIED WORKING

This exact route was built and streamed in **both dev and production**:

```ts
// src/routes/api/sse.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/sse')({
  server: {
    handlers: {
      GET: async () => {
        const enc = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < 3; i++) {
              controller.enqueue(enc.encode(`data: tick ${i}\n\n`))
              await new Promise((r) => setTimeout(r, 250))
            }
            controller.close()
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
```

**[VERIFIED-RUNTIME] observed (dev and prod):**

```
HTTP/1.1 200
cache-control: no-cache
content-type: text/event-stream
Transfer-Encoding: chunked

data: tick 0

data: tick 1

data: tick 2
```

Note the `Transfer-Encoding: chunked` — the response is **not buffered**, and the 250 ms gaps were preserved. SSE is a legitimate option for "new comment appears live" on this stack. Remember to send a heartbeat comment (`: ping\n\n`) and to check `request.signal.aborted` to clean up.

### 9.4 WebSocket — NOT SUPPORTED

**[VERIFIED-SOURCE]** A grep for `websocket` / `upgrade` across `packages/*/src` finds only an unrelated Rsbuild HMR comment. The server contract is `fetch(request: Request): Response` — there is **no upgrade hook, no `101` handling, and no WS session object**.

Workarounds, all external to Start:
- **Node:** front the app with a custom server (`srvx` + `crossws`, or Express + `ws`), or put a WS-capable proxy in front. **[UNVERIFIED]**
- **Cloudflare:** Durable Objects expose WebSockets; you would need a separate Worker/DO and connect the client directly. **[UNVERIFIED]**
- **Fallback:** SSE for server→client plus ordinary `POST` for client→server (a good fit for comments, and fully verified above).

---

## 10. Known limitations, rough edges, and gotchas

### 10.1 RC → v1 breaking changes to watch for

| Change | Detail | Evidence |
|---|---|---|
| **`createServerFileRoute` removed** | Replaced by `createFileRoute(path)({ server: { handlers, middleware } })`. Any tutorial using `.methods({...})` is stale. | **[VERIFIED-SOURCE]** no export anywhere; docs never mention it |
| **`inputValidator` → `validator`** | Both currently work (the same function object); `inputValidator` is `@deprecated … TODO remove upon stable`. The rename went both directions historically (PR #7315 is "Rename validator to inputValidator"), so tutorials disagree. | **[VERIFIED-SOURCE]** `createServerFn.ts:88-93, 509-518` |
| **CSRF middleware added** | Did not exist in early RC. Auto-installed only when `src/start.ts` is absent. | **[VERIFIED-SOURCE]** `createStartHandler.ts:588-595` |
| **Server-route files moved into `src/routes`** | Server routes are now normal file routes with a `server` property. | **[DOC]** |
| **`serverFns.base` path introduced** | `/_serverFn` is now a reserved path prefix. | **[VERIFIED-SOURCE]** |

### 10.2 Real, currently-open gotchas

1. **`createCsrfMiddleware` can leak `node:async_hooks` into the client bundle** — [issue #7460](https://github.com/TanStack/router/issues/7460). Following the *official* docs pattern in `src/start.ts` reportedly crashes the browser with `TypeError: import_node_async_hooks.AsyncLocalStorage is not a constructor` (root cause: `@tanstack/start-storage-context` instantiating `new AsyncLocalStorage()` at module top level being pulled into the client graph). Reported against `@tanstack/react-start` 1.168.9. **[UNVERIFIED by me — I did not add `src/start.ts` to my test app, so I did not reproduce it. Test this early if you plan to use global middleware.]**

2. **`OPTIONS` is intercepted by the Vite dev server** but not by the production server — see §4.4. Dev and prod disagree about your own `OPTIONS` handler. **[VERIFIED-RUNTIME]**

3. **Unmatched HTTP methods return `200 text/html`** (the app shell) instead of `405`. Add an `ANY` handler or global middleware. **[VERIFIED-RUNTIME, dev + prod]**

4. **Server-function errors use HTTP 200.** Validation failures arrive as a successful response with the error in the serialized envelope. Any monitoring/alerting based on status codes will miss them. **[VERIFIED-RUNTIME]**

5. **No built-in CORS.** Not one line of CORS code in the repo. **[VERIFIED-SOURCE]**

6. **Database docs are a stub.** No ORM, no migrations, no pooling guidance. **[VERIFIED-SOURCE]**

7. **Doc/source drift is common.** Examples I confirmed as wrong or stale *in the official docs*:
   - `isr.md` uses a `prerender.routes` option that **does not exist** and is silently ignored by zod. **[VERIFIED-SOURCE]**
   - `deferred-data-loading.md` imports `defer` but never calls it; `deferFunction.md` says it is no longer needed. **[VERIFIED-SOURCE]**
   - `overview.md` still says "Release Candidate" while npm ships 1.168.x. **[VERIFIED-RUNTIME]**
   - Two different `createStartHandler` signatures appear across pages (positional vs options-object). **[VERIFIED-SOURCE]**
   - `getSession` / `deleteCookie` exist and are exported but are absent from the docs. **[VERIFIED-SOURCE]**

8. **Windows dev-server issue** — [discussion #7717](https://github.com/TanStack/router/discussions/7717): *"Nitro adapter fails in dev: Vite environment `ssr` is unavailable on Windows."* **[UNVERIFIED by me — no Windows machine; the title is the evidence I have.]** If you develop on Windows, treat the Nitro-in-dev combination as risky and verify early.

9. **Vite/Rollup version treadmill.** The official example ships `vite ^8.0.14`, `@vitejs/plugin-react ^6.0.1`, `nitro ^3.0.260311-beta`, React 19, and TypeScript aliased to a pre-release (`@typescript/typescript6@^6.0.2`). `nitro/vite` is explicitly *"still under active development"*. Pin everything.

10. **747 releases in the 1.x line.** No SemVer-stable cadence in practice; `latest` moved 5 times in the 8 days before this research. Pin exact versions and read changelogs before bumping.

11. **Hard dependency on `h3@2.0.1-rc.20`** (via the `h3-v2` npm alias) for all server request/response/session helpers. An RC of a foundational HTTP library sits under your production server. **[VERIFIED-SOURCE — `start-server-core/package.json`]**

12. **Content negotiation quirk:** a page route with `Accept: application/json` returns `406 {"error":"Only HTML requests are supported here"}`. This was [issue #7913](https://github.com/TanStack/router/issues/7913) (reported as `500`); the status is now correctly `406`. **[VERIFIED-RUNTIME]** Ensure your API paths never collide with page routes, or you get HTML/406 instead of your JSON.

13. **`spa.enabled` defaults to `true`** once the `spa` key exists, and enabling SPA mode force-enables the prerender phase. A stray `spa: {}` changes your build. **[VERIFIED-SOURCE — `schema.ts`, `post-build.ts`]**

14. **Ecosystem maturity.** Only three official hosting partners (Cloudflare, Netlify, Railway). No AWS Lambda guide. Vercel is a single sentence pointing at Nitro. No admin/plugin marketplace comparable to Next.js. Observability is manual — Sentry is the partner integration; OpenTelemetry support is explicitly *"experimental and requires manual setup"* with first-class support only promised for the future.

### 10.3 What this means for the comment system, concretely

**Use TanStack Start for:** the SSR comment-list page (excellent SEO story), the admin/moderation UI, the React app's own data fetching, and — via server routes — the public REST API.

**Do not use server functions for the public API.** They are CSRF-protected same-origin RPC with a seroval wire format and build-artifact URLs.

**Budget for building yourself:** the DB layer (Drizzle config + migrations + pooling), auth (session storage, password hashing, rate limiting, CSRF for server routes), spam handling, and background moderation jobs.

**Verify before committing:** the `node:async_hooks` client-bundle issue (#7460) if you add `src/start.ts`; preflight CORS against a *production* build, not dev; and the Nitro+Windows dev path if anyone on the team uses Windows.

---

## 11. Verification method (so you can reproduce)

I created a real app under `.tsresearch/verify/app` with:

- `@tanstack/react-start@1.168.57`, `@tanstack/react-router@latest`, React 19, `vite@^8`, `@vitejs/plugin-react@^6`, `zod`
- Routes: `/` (SSR page), `/api/comments` (GET/POST/OPTIONS + CORS), `/api/echo.json` (escaped filename), `/api/items/$id` (GET/DELETE), `/api/sse` (SSE)
- `src/utils/test.functions.ts` with a GET and a POST `createServerFn` (zod-validated)

Commands used:

```bash
# dev
npx vite dev                       # port 3111
curl -i "http://localhost:3111/api/comments?postId=42" -H 'X-Test: abc'
curl -i -X POST http://localhost:3111/api/comments -H 'Content-Type: application/json' -d '{"body":"hi"}'
curl -i -X OPTIONS http://localhost:3111/api/comments -H 'Origin: https://static-blog.example' ...

# server function interrogation
curl -s http://localhost:3111/src/utils/test.functions.ts   # read the compiled createClientRpc("<id>")
curl -i "http://localhost:3111/_serverFn/$ID" -H 'Sec-Fetch-Site: same-origin' -H 'x-tsr-serverFn: true'
curl -i -X POST "http://localhost:3111/_serverFn/$ID" -H 'content-type: application/json' -d "$(node -e "require('seroval').toJSONAsync({data:{body:'hi'}}).then(r=>process.stdout.write(JSON.stringify(r)))")"

# production
npm i -D nitro
# add nitro() to the vite plugin array
npx vite build                     # -> .output/server/index.mjs
PORT=3222 node .output/server/index.mjs
```

Isolated wire-format check:

```bash
npm i seroval@^1.6.2
node --input-type=module -e "
import { fromJSON, toJSONAsync, toCrossJSONAsync } from 'seroval';
try { fromJSON({data:{a:1}}) } catch(e) { console.log('plain JSON THREW:', e.message) }
console.log(JSON.stringify(await toCrossJSONAsync({data:{name:'John'}})));
"
# plain object THREW: Seroval Error (step: 3)
# {"t":10,"i":0,"p":{"k":["data"],"v":[…]},"o":0}
```

The docs clone is at `.tsresearch/router` (sparse checkout: `docs/`, `packages/{react-start,start-client-core,start-server-core,start-plugin-core}`).

---

## 12. Sources

**Primary docs (markdown source in the repo, also live at the URLs shown):**

| Topic | URL |
|---|---|
| Overview | https://tanstack.com/start/latest/docs/framework/react/overview |
| Getting started | https://tanstack.com/start/latest/docs/framework/react/getting-started |
| Build from scratch | https://tanstack.com/start/latest/docs/framework/react/build-from-scratch |
| **Server functions** | https://tanstack.com/start/latest/docs/framework/react/guide/server-functions |
| **Server routes** | https://tanstack.com/start/latest/docs/framework/react/guide/server-routes |
| Middleware | https://tanstack.com/start/latest/docs/framework/react/guide/middleware |
| Hosting | https://tanstack.com/start/latest/docs/framework/react/guide/hosting |
| Databases | https://tanstack.com/start/latest/docs/framework/react/guide/databases |
| Authentication | https://tanstack.com/start/latest/docs/framework/react/guide/authentication |
| Auth server primitives | https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives |
| Auth overview | https://tanstack.com/start/latest/docs/framework/react/guide/authentication-overview |
| Selective SSR | https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr |
| Execution model | https://tanstack.com/start/latest/docs/framework/react/guide/execution-model |
| Code execution patterns | https://tanstack.com/start/latest/docs/framework/react/guide/code-execution-patterns |
| Environment functions | https://tanstack.com/start/latest/docs/framework/react/guide/environment-functions |
| Environment variables | https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables |
| Import protection | https://tanstack.com/start/latest/docs/framework/react/guide/import-protection |
| Streaming from server functions | https://tanstack.com/start/latest/docs/framework/react/guide/streaming-data-from-server-functions |
| Deferred hydration | https://tanstack.com/start/latest/docs/framework/react/guide/deferred-hydration |
| Static prerendering | https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering |
| ISR | https://tanstack.com/start/latest/docs/framework/react/guide/isr |
| SPA mode | https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode |
| Server entry point | https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point |
| Error boundaries | https://tanstack.com/start/latest/docs/framework/react/guide/error-boundaries |
| Observability | https://tanstack.com/start/latest/docs/framework/react/guide/observability |
| Production checklist | https://tanstack.com/start/latest/docs/framework/react/guide/production-checklist |
| SEO | https://tanstack.com/start/latest/docs/framework/react/guide/seo |
| TanStack Query | https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query |
| Router: data loading | https://tanstack.com/router/latest/docs/framework/react/guide/data-loading |

**Blog / press:**
- https://tanstack.com/blog/announcing-tanstack-start-v1 (title: "TanStack Start v1 Release Candidate")
- https://www.infoq.com/news/2025/11/tanstack-start-v1/

**Issues / discussions:**
- https://github.com/TanStack/router/issues/7460 — CSRF middleware leaks `node:async_hooks` into the client bundle
- https://github.com/TanStack/router/issues/7913 — page route returns 500 when `Accept` excludes HTML
- https://github.com/TanStack/router/issues/6643 — SSR build fails when calling a `createServerOnlyFn` result
- https://github.com/TanStack/router/discussions/7717 — Nitro adapter fails in dev on Windows
- https://github.com/TanStack/router/pull/7315 — "docs: Rename validator to inputValidator"

**Cloudflare:**
- https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/

**Examples:**
- `examples/react/start-basic` (`vite.config.ts`, `package.json`) — https://github.com/TanStack/router/tree/main/examples/react/start-basic
- `examples/react/start-bun/server.ts`
- `examples/react/start-basic-auth` (DIY auth + sessions)
