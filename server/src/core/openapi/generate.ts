import type { ResourceRegistry } from '../routing/ResourceRegistry.js'

type OASchema = Record<string, unknown>

function fieldTypeToOASchema(field: Record<string, unknown>): OASchema {
  const base: OASchema = { description: field['label'] as string }
  switch (field['type']) {
    case 'text':
    case 'email':
    case 'url':
    case 'textarea':
    case 'richtext':
    case 'relation':
      return { ...base, type: 'string' }
    case 'number':
      return { ...base, type: 'number' }
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'date':
      return { ...base, type: 'string', format: 'date' }
    case 'select': {
      const opts = (field['options'] as Array<{ value: string }> | undefined) ?? []
      return { ...base, type: 'string', enum: opts.map(o => o.value) }
    }
    case 'array':
    case 'group':
      return { ...base, type: 'object' }
    case 'computed':
      return { ...base, readOnly: true }
    default:
      return { ...base, type: 'string' }
  }
}

function buildObjectSchema(fields: Record<string, unknown>[]): OASchema {
  const properties: Record<string, OASchema> = { id: { type: 'integer' } }
  const required: string[] = []

  for (const f of fields) {
    if (f['type'] === 'computed') continue
    const name = f['name'] as string
    properties[name] = fieldTypeToOASchema(f)
    if (f['required'] === true) required.push(name)
  }

  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

function buildPaths(resourcePath: string, fields: Record<string, unknown>[]): Record<string, OASchema> {
  const schema     = buildObjectSchema(fields)
  const base       = `/${resourcePath}`
  const tag        = resourcePath.split('/').filter(s => !s.startsWith(':')).join('/')
  const summary    = tag.charAt(0).toUpperCase() + tag.slice(1)

  const listResponse = {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              ok:   { type: 'boolean' },
              data: { type: 'array', items: schema },
              meta: {
                type: 'object',
                properties: {
                  total:    { type: 'integer' },
                  page:     { type: 'integer' },
                  pageSize: { type: 'integer' },
                  hasNext:  { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  }

  const itemResponse = {
    200: {
      description: 'Success',
      content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: schema } } } },
    },
    404: { description: 'Not found' },
  }

  const inputSchema: OASchema = { ...schema }
  const inputProps = inputSchema['properties'] as Record<string, unknown> | undefined
  if (inputProps) delete inputProps['id']

  return {
    [base]: {
      get: {
        tags: [summary],
        summary: `List ${summary}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'fields',   in: 'query', schema: { type: 'string' }, description: 'Comma-separated field names for sparse fieldsets' },
        ],
        responses: listResponse,
      },
      post: {
        tags: [summary],
        summary: `Create ${summary.slice(0, -1)}`,
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: inputSchema } } },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: schema } } } } },
          422: { description: 'Validation error' },
        },
      },
    },
    [`${base}/{id}`]: {
      get: {
        tags: [summary],
        summary: `Get ${summary.slice(0, -1)}`,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: itemResponse,
      },
      put: {
        tags: [summary],
        summary: `Replace ${summary.slice(0, -1)}`,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: inputSchema } } },
        responses: { ...itemResponse, 422: { description: 'Validation error' } },
      },
      patch: {
        tags: [summary],
        summary: `Partially update ${summary.slice(0, -1)}`,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: inputSchema } } },
        responses: { ...itemResponse, 422: { description: 'Validation error' } },
      },
      delete: {
        tags: [summary],
        summary: `Delete ${summary.slice(0, -1)}`,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },
  }
}

export function generateOpenApiSpec(registry: ResourceRegistry, title: string, version: string): object {
  const paths: Record<string, OASchema> = {}

  for (const { path, Ctor } of registry.getResources()) {
    try {
      const resource = new Ctor() as { form?: { toSchema?: (ctx: object) => { fields?: unknown[] } } }
      const schema   = resource.form?.toSchema?.({}) ?? {}
      const fields   = (schema.fields ?? []) as Record<string, unknown>[]
      Object.assign(paths, buildPaths(path, fields))
    } catch {
      // Resource may require DB or have side effects — skip gracefully
    }
  }

  return {
    openapi: '3.1.0',
    info:    { title, version },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths,
  }
}

export function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '${specUrl}', dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset] })
  </script>
</body>
</html>`
}
