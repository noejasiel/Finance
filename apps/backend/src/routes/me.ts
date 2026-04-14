import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "@finance/shared";

export async function meRoutes(app: FastifyInstance) {
  // GET /api/v1/me
  app.get(`${API_PREFIX}/me`, async (req, reply) => {
    // TODO: extract userId from session cookie
    const userId: string | null = null;
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    // Placeholder — will return user data once session auth is wired
    return reply.send({ ok: true, data: { user: null } });
  });
}
