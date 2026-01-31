import { SearchQuery, SearchResults } from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { searchService } from "./search.service";

export async function searchRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/search",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: SearchQuery,
        response: { 200: SearchResults },
      },
    },
    async (req) =>
      searchService.search(db, req.firm.id, req.query.q, req.firm.role),
  );
}
