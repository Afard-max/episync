import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../modules/storage/db.js";
import { users } from "../modules/storage/schema.js";
import { generateApiKey, hashApiKey } from "../modules/storage/api-key.js";

const createUserBodySchema = z.object({
  display_name: z.string().min(1).max(80),
  invite_secret: z.string().min(1),
});

const usersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/users", async (request, reply) => {
    const parsed = createUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Datos de alta de usuario inválidos.",
        details: parsed.error.flatten(),
      });
    }
    const { display_name, invite_secret } = parsed.data;

    const expectedSecret = process.env.INVITE_SECRET;
    if (!expectedSecret) {
      request.log.error("INVITE_SECRET no está configurado en el entorno.");
      return reply.status(500).send({
        error: "server_misconfigured",
        message: "El servidor no puede procesar altas en este momento.",
      });
    }

    const providedBuffer = Buffer.from(invite_secret);
    const expectedBuffer = Buffer.from(expectedSecret);
    const secretsMatch =
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer);

    if (!secretsMatch) {
      return reply.status(403).send({
        error: "invalid_invite_secret",
        message: "Clave de invitación incorrecta.",
      });
    }

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const [createdUser] = await db
      .insert(users)
      .values({ displayName: display_name, apiKeyHash })
      .returning();

    return reply.status(201).send({
      user_id: createdUser.id,
      display_name: createdUser.displayName,
      api_key: apiKey,
    });
  });
};

export default usersRoutes;
