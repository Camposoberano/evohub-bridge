# Ponte EVO Hub <-> Chatwoot (Deno). Coolify builda este Dockerfile.
# Pino a versão para builds reprodutíveis; atualize conscientemente.
FROM denoland/deno:alpine-2.1.4

WORKDIR /app

# ffmpeg: transcodifica áudio de saída pra ogg/opus (voz/PTT no WhatsApp)
# A imagem Deno tem /usr/local/lib/libgcc_s.so.1 incompatível; força /usr/lib no check.
RUN apk add --no-cache ffmpeg && LD_LIBRARY_PATH=/usr/lib:/lib ffmpeg -version > /dev/null

# Cache de dependências (esm.sh) — copia só os fontes necessários
COPY deno.json deno.json
COPY shared/ shared/
COPY handlers/ handlers/
COPY server.ts server.ts

# check = type-check + cache. Falha o build em erro de tipo (em vez de runtime).
RUN deno check server.ts

EXPOSE 8000

# Permissões: rede (Hub/Chatwoot/Supabase) + env (segredos) + run/read/write (ffmpeg + temp)
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-run", "--allow-read", "--allow-write", "server.ts"]
