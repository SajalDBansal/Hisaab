import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

/** API docs at /docs, generated from the same zod schemas that check requests. Off in production. */
export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: { info: { title: "Hisaab API", version: "1.0.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
