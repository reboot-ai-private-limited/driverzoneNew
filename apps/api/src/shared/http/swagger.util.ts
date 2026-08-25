import { OpenApiGeneratorV3, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * SHARED — OpenAPI/Swagger generation, built from the same Zod schemas each module already
 * validates requests with. Not a hand-written spec: a hand-written spec is a second copy of the
 * request shape that drifts from the real one exactly like an un-typechecked wire DTO would (see
 * `zones/interface/zones.typecheck.ts` for the same problem solved at the TypeScript level).
 *
 * `extendZodWithOpenApi` must run before any module's swagger file registers a path — it patches
 * `ZodType` with the `.openapi()` method the generator's traversal relies on, even for schemas
 * that never call it directly. Doing it here, at import time, is the one place guaranteed to run
 * before every module's registration function does.
 */
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

/** Every admin route needs this — `[{ bearerAuth: [] }]` on a `registerPath` call. */
export const bearerAuth = [{ bearerAuth: [] }];

/**
 * Matches `RequestMeta` in `@driverzone/contracts`'s `http.ts` exactly. `ip` is genuinely
 * optional on the wire (omitted in production), so it stays optional here too rather than
 * being dropped for a simpler-looking doc — a doc that hides a real field is worse than one
 * that shows it as optional.
 */
const requestMetaSchema = z.object({
  method: z.string(),
  url: z.string(),
  requestId: z.string(),
  ip: z.string().optional(),
});

/**
 * Matches `HttpSuccessBody<T>` exactly — `statusCode` and `request` are real fields on every
 * response this API sends, not envelope boilerplate safe to leave out of the docs.
 */
export function successResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    statusCode: z.number(),
    request: requestMetaSchema,
    message: z.string(),
    data: dataSchema,
  });
}

/**
 * Matches `HttpErrorBody` exactly. `data` here is `AppError.publicDetails` — present on most
 * faults (e.g. `{ violations: [...] }` on a `ZONE_VALIDATION_FAILED`) but not guaranteed, so it
 * stays optional rather than typed as always-present.
 */
export const errorResponse = z.object({
  success: z.literal(false),
  statusCode: z.number(),
  code: z.string(),
  request: requestMetaSchema,
  message: z.string(),
  data: z.unknown().optional(),
});

/**
 * Builds the OpenAPI document from whatever has been registered so far. Call this AFTER every
 * module's `register*SwaggerPaths()` has run, not before — `registry.definitions` is read once,
 * at generation time.
 *
 * Explicit return type: TS cannot otherwise name the inferred type without a direct reference
 * into `openapi3-ts`'s internals (TS2742), since that package isn't a direct dependency here.
 */
export function generateOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'DriverZone API',
      version: '0.1.0',
      description:
        'Generated from the same Zod schemas the API validates requests with — see ' +
        'apps/api/src/shared/http/swagger.util.ts.',
    },
    servers: [{ url: '/api', description: 'This server' }],
  });
}
