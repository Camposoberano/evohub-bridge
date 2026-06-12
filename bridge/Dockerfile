# Ponte EVO Hub <-> Chatwoot (Deno). Coolify builda este Dockerfile.
# Pino a versão para builds reprodutíveis; atualize conscientemente.
FROM denoland/deno:alpine-2.1.4

WORKDIR /app

# Cache de dependências (esm.sh) — copia só os fontes necessários
COPY deno.json deno.json
COPY shared/ shared/
COPY handlers/ handlers/
COPY server.ts server.ts

# check = type-check + cache. Falha o build em erro de tipo (em vez de runtime).
RUN deno check server.ts

EXPOSE 8000

# Permissões mínimas: rede (Hub/Chatwoot/Supabase) + env (segredos)
CMD ["deno", "run", "--allow-net", "--allow-env", "server.ts"]
