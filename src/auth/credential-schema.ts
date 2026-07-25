import { z } from "zod";

export const oauthCredentialsSchema = z
  .object({
    clientId: z.string().min(10).max(300),
    clientSecret: z.string().min(1).max(1024).optional(),
    refreshToken: z.string().min(4).max(4096),
    accessToken: z.string().min(1).max(8192).optional(),
    accessTokenExpiresAt: z.number().finite().optional(),
    scopes: z.array(z.string().url()).min(1).max(10),
    tokenType: z.string().max(64).optional(),
    accountEmail: z.string().email().max(320).optional(),
    accountDisplayName: z.string().min(1).max(500).optional(),
  })
  .strict();
