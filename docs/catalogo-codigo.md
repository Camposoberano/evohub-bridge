# Catálogo do código e dos utilitários

**Base:** `main` em `08c6e5c`, 22/10/2026. Esta é uma navegação de arquivos e exports detectados por análise textual; não substitui leitura da implementação nem confirma ativação em produção. O [mapa de arquitetura](arquitetura-e-fluxos.md) explica os fluxos; o [catálogo de comandos](funcoes-e-comandos.md) explica o uso operacional.

## Handlers HTTP (38)

| Arquivo | Exports identificados |
|---|---|
| [`bridge/handlers/campaign.ts`](../bridge/handlers/campaign.ts) | handle |
| [`bridge/handlers/catalog.ts`](../bridge/handlers/catalog.ts) | isCatalogJourneyActive, sendCatalogRootMenu, routeCatalogText, sendCatalogJourneyReminder, leaveCatalogJourney, handleQualificationReply, handleCatalogClick |
| [`bridge/handlers/channel-health.ts`](../bridge/handlers/channel-health.ts) | handle |
| [`bridge/handlers/channel-sync.ts`](../bridge/handlers/channel-sync.ts) | achaIdSocial, syncChannels, handle |
| [`bridge/handlers/chatwoot-accounts.ts`](../bridge/handlers/chatwoot-accounts.ts) | handle |
| [`bridge/handlers/chatwoot-webhook.ts`](../bridge/handlers/chatwoot-webhook.ts) | deferBackground, handle, handleOutgoing |
| [`bridge/handlers/clientes.ts`](../bridge/handlers/clientes.ts) | handle |
| [`bridge/handlers/connect-channel.ts`](../bridge/handlers/connect-channel.ts) | handle |
| [`bridge/handlers/connect-uazapi.ts`](../bridge/handlers/connect-uazapi.ts) | ProntidaoInstancia, relatorioProntidao, handle |
| [`bridge/handlers/conversation-outcome.ts`](../bridge/handlers/conversation-outcome.ts) | handle |
| [`bridge/handlers/funil-control.ts`](../bridge/handlers/funil-control.ts) | motivoTerminal, handle, dispatchRecovery |
| [`bridge/handlers/funil-enroll.ts`](../bridge/handlers/funil-enroll.ts) | GAPS, FIM_ACESSO, saudacaoDinamica, FASES, FASES_LEGADAS, iniciosDosAcessos, handle, icebreakersConfigurados, ehAberturaDeAnuncioSocial, AutoEnrollResult; +3 |
| [`bridge/handlers/funil-queue-pump.ts`](../bridge/handlers/funil-queue-pump.ts) | handle |
| [`bridge/handlers/funnel-ops.ts`](../bridge/handlers/funnel-ops.ts) | handle |
| [`bridge/handlers/hub-webhook.ts`](../bridge/handlers/hub-webhook.ts) | handle, REVISAR_VENDA_LABEL, recordInboundCommercialIntent, handleSocialPrecoClick, handleSocialSalesIntent, handlePrecoClick, handleVideoSequence, handlePlantioClick, handleNutricaoClick, handleHumanRequest; +3 |
| [`bridge/handlers/hybrid-ops.ts`](../bridge/handlers/hybrid-ops.ts) | authenticatedUser, handle |
| [`bridge/handlers/hybrid-routes.ts`](../bridge/handlers/hybrid-routes.ts) | handle |
| [`bridge/handlers/inbound-incidents.ts`](../bridge/handlers/inbound-incidents.ts) | runInboundWatchdog, handle |
| [`bridge/handlers/label-window.ts`](../bridge/handlers/label-window.ts) | handle |
| [`bridge/handlers/llm-orchestrate.ts`](../bridge/handlers/llm-orchestrate.ts) | handle |
| [`bridge/handlers/media-retention.ts`](../bridge/handlers/media-retention.ts) | lerBuckets, handle |
| [`bridge/handlers/meta-templates.ts`](../bridge/handlers/meta-templates.ts) | handle |
| [`bridge/handlers/metrics-rollup.ts`](../bridge/handlers/metrics-rollup.ts) | handle |
| [`bridge/handlers/n8n-action-enqueue.ts`](../bridge/handlers/n8n-action-enqueue.ts) | QueuePiece, resolveActionMedia, EnqueueBody, ActionQueueRow, validateEnqueueBody, buildActionRows, nextActionWindow, handle |
| [`bridge/handlers/n8n-action-send-now.ts`](../bridge/handlers/n8n-action-send-now.ts) | validImmediateRequest, handle |
| [`bridge/handlers/n8n-queue.ts`](../bridge/handlers/n8n-queue.ts) | queueBaseVersion, queueBlockReason, shouldCancelTerminal5895, handle |
| [`bridge/handlers/n8n-reconcile-5895.ts`](../bridge/handlers/n8n-reconcile-5895.ts) | handle |
| [`bridge/handlers/operational-health.ts`](../bridge/handlers/operational-health.ts) | DESLIGAMENTO_INTENCIONAL, runOperationalAudit, handle |
| [`bridge/handlers/relatorio.ts`](../bridge/handlers/relatorio.ts) | handle |
| [`bridge/handlers/repair-official-5895.ts`](../bridge/handlers/repair-official-5895.ts) | handle |
| [`bridge/handlers/send-outbound.ts`](../bridge/handlers/send-outbound.ts) | handle |
| [`bridge/handlers/sync-chatwoot-out.ts`](../bridge/handlers/sync-chatwoot-out.ts) | handle, recentOutgoingCandidates |
| [`bridge/handlers/sync-comments.ts`](../bridge/handlers/sync-comments.ts) | handle |
| [`bridge/handlers/sync-facebook.ts`](../bridge/handlers/sync-facebook.ts) | handle, anexoUsaTokenDoCanal, extractShareLinks, conteudoDeEntrada |
| [`bridge/handlers/sync-labels.ts`](../bridge/handlers/sync-labels.ts) | handle |
| [`bridge/handlers/sync-wa-labels.ts`](../bridge/handlers/sync-wa-labels.ts) | handle |
| [`bridge/handlers/uazapi-webhook.ts`](../bridge/handlers/uazapi-webhook.ts) | handle, rotuloDeEvento, processInboundUazapiEvent, normalizarNumero, isNumeroDaCasa, requiresInstanceToken |
| [`bridge/handlers/uazapi.ts`](../bridge/handlers/uazapi.ts) | handle |

## Módulos compartilhados (105)

| Arquivo | Exports identificados |
|---|---|
| [`bridge/shared/5895-media-incidents.ts`](../bridge/shared/5895-media-incidents.ts) | MediaBlock5895, mediaBlocks5895, mediaBlocks5895Detail, mediaBlocks5895Key |
| [`bridge/shared/accounts.ts`](../bridge/shared/accounts.ts) | accountForChannel, getChannelMap, setAccountForChannel, acctByKey |
| [`bridge/shared/ad-funnel-watchdog.ts`](../bridge/shared/ad-funnel-watchdog.ts) | reconcileNewAdFunnels |
| [`bridge/shared/ad-lead.ts`](../bridge/shared/ad-lead.ts) | foldText, normalizedWords, isAdFunnelOriginSignal, shouldDeferInitialAdIntent, deferredAdRoute, pareceAberturaComercial, isDefaultAdMessage |
| [`bridge/shared/ad-opening.ts`](../bridge/shared/ad-opening.ts) | sendFirstAdFunnelPieceNow |
| [`bridge/shared/ancoragem-preco.ts`](../bridge/shared/ancoragem-preco.ts) | textoDeAncoragem, temValorOuData |
| [`bridge/shared/async-video-receipt.ts`](../bridge/shared/async-video-receipt.ts) | VideoReceiptCriteria, shouldUseAsyncVideoReceipt, matchingAsyncVideoReceipt, AsyncVideoReceiptError, waitForVideoReceipt |
| [`bridge/shared/audio.ts`](../bridge/shared/audio.ts) | caminhoDoAudio, ehObjetoJaExistente, toVoiceOgg, toSocialAudio |
| [`bridge/shared/avatar-sync.ts`](../bridge/shared/avatar-sync.ts) | avatarStep |
| [`bridge/shared/bot-mute.ts`](../bridge/shared/bot-mute.ts) | BOT_MUTE_LABEL, mutedConversationIds, isBotMuted, isBotMutedForContact, reconcileBotMute |
| [`bridge/shared/business-hours.ts`](../bridge/shared/business-hours.ts) | FUNNEL_OPEN_MINUTE, FUNNEL_CLOSE_BUFFER_MINUTES, FUNNEL_CUTOFF_MINUTE, brtMinuteOfDay, isWithinFunnelSendHours, nextFunnelSendAt |
| [`bridge/shared/business-time.ts`](../bridge/shared/business-time.ts) | clampBusinessTime, addBusinessSeconds |
| [`bridge/shared/campaign-pace.ts`](../bridge/shared/campaign-pace.ts) | PaceConfig, PACE_PADRAO, capDoDia, dentroDaJanela, intervaloMs, DecisaoEnvio, podeEnviarAgora, inicioDoDiaBrt |
| [`bridge/shared/campaign-preflight.ts`](../bridge/shared/campaign-preflight.ts) | CampaignPreflightUnavailable, CampaignPreflightResult, validarContatoAntesDaCampanha |
| [`bridge/shared/campaign-queue.ts`](../bridge/shared/campaign-queue.ts) | FilaItem, reservarProximoItem, reservarProximoItemRotacao, pendentesElegiveis, enfileirar, enviadosHoje, ultimoEnvioAt, marcarEnviado, marcarFalha, marcarPulado; +9 |
| [`bridge/shared/campaign-rotation.ts`](../bridge/shared/campaign-rotation.ts) | ROTATION_GROUPS, ROTATION_CAMPAIGNS, CampaignRotationSnapshot, RotationDecision, chooseCampaignRotation |
| [`bridge/shared/campaigns.ts`](../bridge/shared/campaigns.ts) | Step, Campaign, Target, CampaignState, readCampaigns, writeCampaigns, numKey |
| [`bridge/shared/catchup-uazapi.ts`](../bridge/shared/catchup-uazapi.ts) | cliqueRespondeEspera, respostaInterativaRecuperada, MARGEM_WEBHOOK_MS, JANELA_PADRAO_MS, JANELA_MAXIMA_MS, JANELA_PROFUNDA_MS, PAGINA_FIND, MAX_PAGINAS_FIND, msDoTimestamp, dataDaQueda; +10 |
| [`bridge/shared/chatwoot-assignee.ts`](../bridge/shared/chatwoot-assignee.ts) | ConversationAssigneeUpdate, readConversationAssigneeUpdate |
| [`bridge/shared/chatwoot.ts`](../bridge/shared/chatwoot.ts) | CwAcct, envAcct, profileId, addInboxMembers, ChatwootAttachment, createApiInbox, resolveInboxIdentifier, findInboxByName, setInboxWebhook, ensureContact; +7 |
| [`bridge/shared/commercial-outcome-labels.ts`](../bridge/shared/commercial-outcome-labels.ts) | LabelPorts, applyNoPurchaseLabels, ensureNoPurchaseLabels, reconcileNoPurchaseRemoval, confirmNoPurchaseLabelsAbsent, shouldReleaseNoPurchaseBlock |
| [`bridge/shared/completion-label.ts`](../bridge/shared/completion-label.ts) | applyCompletionLabel |
| [`bridge/shared/customer.ts`](../bridge/shared/customer.ts) | customerIdentityKey, ensureCustomer, customerFromContact |
| [`bridge/shared/ddd.ts`](../bridge/shared/ddd.ts) | ufFromPhone |
| [`bridge/shared/decline-guard.ts`](../bridge/shared/decline-guard.ts) | DECLINE_BUTTON_TEXTS, DeclineGuardResult, runDeclineGuard |
| [`bridge/shared/destino-seguro.ts`](../bridge/shared/destino-seguro.ts) | ehIpInterno, ehHostInterno, DestinoAvaliado, avaliarDestino |
| [`bridge/shared/document-delivery.ts`](../bridge/shared/document-delivery.ts) | FunnelDocumentInput, DocumentDeliveryResult, decideDocumentRoute, sendFunnelDocument |
| [`bridge/shared/embrapa-offer-reply.ts`](../bridge/shared/embrapa-offer-reply.ts) | EMBRAPA_5895_CAMPAIGN_ID, shouldDeferEmbrapaPdf, resolveEmbrapaOfferReply |
| [`bridge/shared/enrich.ts`](../bridge/shared/enrich.ts) | enrichStep |
| [`bridge/shared/env.ts`](../bridge/shared/env.ts) | env, optionalEnv |
| [`bridge/shared/envio-multiplo.ts`](../bridge/shared/envio-multiplo.ts) | EnvioIndividual, ResumoDeEnvios, resumoDeEnvios, notaDeEnvioParcial |
| [`bridge/shared/erros.ts`](../bridge/shared/erros.ts) | descreveErro |
| [`bridge/shared/flow-inbound.ts`](../bridge/shared/flow-inbound.ts) | flowChannelFor, pumpFlowTimeouts, continueFlowOnReply, pumpDeferredEmbrapaPdf |
| [`bridge/shared/flow-record.ts`](../bridge/shared/flow-record.ts) | textoDoStep, msgTypeDoStep, gravadorDeFluxo |
| [`bridge/shared/flow-runner.ts`](../bridge/shared/flow-runner.ts) | FlowPosition, FlowChannel, RunResult, OnStepSent, runFlow, advanceFlow, esperaVencida |
| [`bridge/shared/flow-state.ts`](../bridge/shared/flow-state.ts) | FlowStateRow, contactKey, saveFlowPosition, claimFlowStep, deferFlowStep, findDeferredFlows, claimDeferredFlow, setClaimedFlowStatus, findDeferredFlowForContact, cancelDeferredFlow; +2 |
| [`bridge/shared/flow.ts`](../bridge/shared/flow.ts) | FlowButton, FlowSectionRow, FlowSection, FlowStepKind, FlowTemplate, FlowStep, Flow, esperaResposta, stepById, primeiroStep; +4 |
| [`bridge/shared/funil-anuncio.ts`](../bridge/shared/funil-anuncio.ts) | CanalFunil, MotivoEntradaAnuncio, EvidenciaEntradaAnuncio, canalAlvoFunil, usaNovoFunilNoCanal, motivoEntradaAnuncio, suprimirAberturaGenerica, deveAdiarPausaDaAbertura, deveIgnorarInscricaoHistorica, deveEncaminharPerguntaDeAnuncio; +2 |
| [`bridge/shared/funil-comercial-relatorio.ts`](../bridge/shared/funil-comercial-relatorio.ts) | FunilComercialEvent, FunilComercialOutcome, CanalFunilComercial, FunilComercialSummary, summarizeFunilComercial |
| [`bridge/shared/funil-comercial.ts`](../bridge/shared/funil-comercial.ts) | IntencaoFunilComercial, PacoteComercial, PACOTES_COMERCIAIS, OPCOES_DE_USO, classificarIntencaoComercial, pacotePorId, pacotePorResposta, textoPerguntaUso, textoCondicaoComercial, textoPacote; +5 |
| [`bridge/shared/funil-pausa.ts`](../bridge/shared/funil-pausa.ts) | horasDePausa, ehPrimeiraMensagem, chaveDaPausa, marcarPausa, limparPausa, vencidas, pausasVencidas, podeRetomar |
| [`bridge/shared/funnel-delivery.ts`](../bridge/shared/funnel-delivery.ts) | MAX_AUTOMATIC_DELIVERY_RETRIES, FunnelDeliveryOutcome, FunnelDeliveryMetadata, FunnelDeliveryEvent, deliveryMetadata, withConfirmedVideoReceipt, FUNNEL_SEQUENCE_ID_KEY, payloadWithoutDeliveryMetadata, payloadWithDeliveryMetadata, nextFunnelRetryAt; +3 |
| [`bridge/shared/funnel-identity.ts`](../bridge/shared/funnel-identity.ts) | LEGACY_MAIN_FUNNEL, AD_5895_FUNNEL, RESTORED_5895_FUNNEL, SOCIAL_N8N_FUNNEL, AD_5895_FUNNEL_LABEL, LEGACY_MAIN_FUNNEL_LABEL, RESTORED_5895_FUNNEL_LABEL, SOCIAL_N8N_FUNNEL_LABEL, MAIN_FUNNELS, funnelVersionForChannel; +4 |
| [`bridge/shared/funnel-queue.ts`](../bridge/shared/funnel-queue.ts) | businessShiftMinutes, pumpFunnelQueue |
| [`bridge/shared/funnel-recovery.ts`](../bridge/shared/funnel-recovery.ts) | FunnelMaintenanceResult, rebasePausedSchedule, resumeSequenceRebased, canAutoResume, stillBlocksCompletion, silentFollowupAt, canSendSilentFollowup, maintainFunnels |
| [`bridge/shared/funnel-state.ts`](../bridge/shared/funnel-state.ts) | canRecreateMissingOpening, hasFunnelDeliveryEvidence, openingMessagesComplete, autoPauseFunil |
| [`bridge/shared/gate-comercial.ts`](../bridge/shared/gate-comercial.ts) | Bloqueio, motivoDoBloqueio, bloqueioDaConversa, bloqueiosPorConversa, bloqueioPorContato |
| [`bridge/shared/hmac.ts`](../bridge/shared/hmac.ts) | hmacSha256Hex, timingSafeEqual, verifyHubSignature |
| [`bridge/shared/hub.ts`](../bridge/shared/hub.ts) | sendMeta, getMeta, sendMetaMessage, uploadMetaMedia, getChannelDetail, createChannel, createMessagesWebhook, publicConnectUrl |
| [`bridge/shared/hybrid-config.ts`](../bridge/shared/hybrid-config.ts) | HybridChannelConfig, HybridConfig, readHybridConfig, setHybridChannelConfig, configuredChannel |
| [`bridge/shared/hybrid-extra.ts`](../bridge/shared/hybrid-extra.ts) | hybridSendPoll, CarouselCard, hybridSendCarousel, PixType, hybridSendPixButton, hybridRequestPayment, ProntidaoInstancia, checarProntidao |
| [`bridge/shared/hybrid-list.ts`](../bridge/shared/hybrid-list.ts) | HybridListRow, HybridListSection, MAX_ROWS_PER_SECTION, buildHybridListPayload, buildHybridListFallback, paginateRows |
| [`bridge/shared/hybrid-menu.ts`](../bridge/shared/hybrid-menu.ts) | HybridMenuButton, buildHybridMenuPayload, buildHybridMenuFallback, normalizeHybridMenuClick, normalizeHybridButtonReply |
| [`bridge/shared/hybrid.ts`](../bridge/shared/hybrid.ts) | HybridRoute, getHybridRoute, getDirectUazapiRoute, SendResult, UncertainDeliveryError, isHybridRecipient, hybridSendText, hybridSendMedia, hybridSendMenu, hybridSendList |
| [`bridge/shared/inbound-incidents.ts`](../bridge/shared/inbound-incidents.ts) | InboundIncident, inbound5895AlertCandidates, inbound5895AlertKey, inboundCandidate, inboundState, auditInboundIncidents |
| [`bridge/shared/inbound.ts`](../bridge/shared/inbound.ts) | providerEchoKey, InboundAttachment, IngestInboundMessage, ingestInbound, repairInboundMedia |
| [`bridge/shared/intent-dedup.ts`](../bridge/shared/intent-dedup.ts) | CommercialIntent, brtDay, dailyIntentKey, normalizeContactId, claimDailyIntent, releaseDailyIntent, claimDailyTag |
| [`bridge/shared/intent.ts`](../bridge/shared/intent.ts) | fold, isPrecoIntent, isLogisticaIntent, isDuvidaTecnicaIntent, isInteresseComercialIntent, UsoComercial, detectarUsoComercial, isVideoIntent, isPlantioIntent, isNutricaoIntent; +4 |
| [`bridge/shared/iscas.ts`](../bridge/shared/iscas.ts) | Isca, ISCAS, IscaMatch, matchIsca, iscasAtivas |
| [`bridge/shared/journey-router.ts`](../bridge/shared/journey-router.ts) | JourneyDomain, clickDomain, canRouteClick, directInstanceCandidates, catalogTextClaimKey |
| [`bridge/shared/lead-block.ts`](../bridge/shared/lead-block.ts) | isContactBlocked, isContactExcludedFromAutomation, blockContact |
| [`bridge/shared/lead-profile.ts`](../bridge/shared/lead-profile.ts) | Json, normalizeLeadAttribution, sourceSnapshot, mergeLeadAttributes, syncInboundCliente |
| [`bridge/shared/llm-orchestrator.ts`](../bridge/shared/llm-orchestrator.ts) | TaskArea, RiskLevel, GateStatus, QualityGates, OrchestrationTask, ModelProfile, ModelRuntime, ModelCandidate, RoutingWeights, RoutingInput; +10 |
| [`bridge/shared/loop-guard.ts`](../bridge/shared/loop-guard.ts) | GuardaDeLoop, criarGuardaDeLoop, agendarLoop |
| [`bridge/shared/lotes.ts`](../bridge/shared/lotes.ts) | LOTE_IDS, emLotes, consultaEmLotes |
| [`bridge/shared/macro-command-id.ts`](../bridge/shared/macro-command-id.ts) | currentMacroRequestId, clearMacroRequestId |
| [`bridge/shared/media-relay.ts`](../bridge/shared/media-relay.ts) | relayProviderMedia |
| [`bridge/shared/meta-errors.ts`](../bridge/shared/meta-errors.ts) | metaErrorDetail, isMetaWindowError, isMetaThreadControlError, metaDeliveryStatus |
| [`bridge/shared/midia-funil.ts`](../bridge/shared/midia-funil.ts) | tamanhoDaMidiaEmCache, limparCacheMidia, midiaDisponivel, AcaoSemMidia, decidirSemMidia, urlDaPeca |
| [`bridge/shared/msg-type.ts`](../bridge/shared/msg-type.ts) | MsgType, normalizeMsgType, isUnmappedMsgType |
| [`bridge/shared/n8n-action-contract.ts`](../bridge/shared/n8n-action-contract.ts) | SOBERANO_ACTIONS, SoberanoAction, ActionRequest, isSoberanoAction, actionKey, actionUuid |
| [`bridge/shared/n8n-action-router.ts`](../bridge/shared/n8n-action-router.ts) | ActionDispatchResult, enabledN8nActions, actionWebhookUrl, dispatchSoberanoAction |
| [`bridge/shared/n8n-recovery.ts`](../bridge/shared/n8n-recovery.ts) | recoveryVariation, allRecoveryPiecesSent, confirmN8nRecovery |
| [`bridge/shared/native.ts`](../bridge/shared/native.ts) | isNativeChannel |
| [`bridge/shared/negative-intent.ts`](../bridge/shared/negative-intent.ts) | isNegativeIntent |
| [`bridge/shared/openai-exec.ts`](../bridge/shared/openai-exec.ts) | OpenAIExecInput, OpenAIExecResult, executeOpenAIText |
| [`bridge/shared/operational-alert.ts`](../bridge/shared/operational-alert.ts) | OperationalIssue, InstanciaUazapi, temWebhookUazapiDoHub, instanciaConectada, avaliarInstanciasUazapi, AvaliacaoDeSilencio, avaliarSilencio, alertasParaEntregar, formatarAlerta, entregarAlertas |
| [`bridge/shared/outbound-dedup.ts`](../bridge/shared/outbound-dedup.ts) | outboundClaimKey |
| [`bridge/shared/outcome-labels.ts`](../bridge/shared/outcome-labels.ts) | Outcome, WA_PREFIX, canonize, deriveOutcome, isClosedOutcome, splitByOrigin, mergeLabels, sameLabels |
| [`bridge/shared/pedido-humano.ts`](../bridge/shared/pedido-humano.ts) | OrigemPedido, ResultadoPedidoHumano, registrarPedidoHumano |
| [`bridge/shared/prompt-cache.ts`](../bridge/shared/prompt-cache.ts) | PromptCacheKeyParts, PromptCacheMetrics, buildPromptCacheKey, supportsExplicitPromptCaching, buildPromptCacheRequest, cacheableTextBlock, extractPromptCacheMetrics |
| [`bridge/shared/reconcile-5895.ts`](../bridge/shared/reconcile-5895.ts) | reconcilable5895Type, ReconcileSummary, matchingReceipt, matchingSentVideoCopy, uniqueConfirmedReceipt, reconcile5895Uncertain, reconcile5895VideoNotice |
| [`bridge/shared/recovery-chain.ts`](../bridge/shared/recovery-chain.ts) | RECOVERY_CHAIN_DAYS, ABANDONO_MS, ATENDIMENTO_RECENTE_MS, isAbandonedFunnel, withinRecoveryHours, RecoveryDecision, dueRecoveryVariation, shouldMarkLostBySilence, recuperacaoBloqueada, RecoveryChainResult; +3 |
| [`bridge/shared/recovery-content.ts`](../bridge/shared/recovery-content.ts) | RecoveryPiece, RecoveryMedia, RECOVERY_ACTIONS, recoveryPieces |
| [`bridge/shared/recovery-template.ts`](../bridge/shared/recovery-template.ts) | RECOVERY_TEMPLATE_LANG, TEMPLATES_EM_USO, templateFor, TemplateSendResult, sendRecoveryTemplate |
| [`bridge/shared/redact.ts`](../bridge/shared/redact.ts) | redactSecrets, sufixoContato |
| [`bridge/shared/report-auth.ts`](../bridge/shared/report-auth.ts) | cronToken, isAuthedCronOrUser |
| [`bridge/shared/restored-funnel-buttons.ts`](../bridge/shared/restored-funnel-buttons.ts) | RestoredButtonAction, restoredButtonAction, isRestoredFunnelButton, RESTORED_BUTTON_IDS |
| [`bridge/shared/safe-media-download.ts`](../bridge/shared/safe-media-download.ts) | MAX_MEDIA_BYTES, fetchSafeMedia, readLimitedMedia |
| [`bridge/shared/segredo-bridge.ts`](../bridge/shared/segredo-bridge.ts) | segredoEmRotacao, confereSegredo, segredoParaChamadaInterna |
| [`bridge/shared/social-autoreply.ts`](../bridge/shared/social-autoreply.ts) | SocialAutoReplyRule, SocialAutoReplyConfig, SocialAutoReplyComment, normalizeSocialText, matchSocialAutoReply, readSocialAutoReplyConfig, maybeAutoReplySocialComment |
| [`bridge/shared/social-channel-allowlist.ts`](../bridge/shared/social-channel-allowlist.ts) | APPROVED_SOCIAL_CHANNEL_IDS, configuredSocialChannelIds, isApprovedSocialChannel |
| [`bridge/shared/social-funnel.ts`](../bridge/shared/social-funnel.ts) | SocialMessage, socialPartReceiptPayload, socialPriceActionClaimKey, renderSocialFunnelMessages, inferSocialPriceReply, inferSocialPriceReplyFromPrompts |
| [`bridge/shared/social-lead-entry.ts`](../bridge/shared/social-lead-entry.ts) | SocialLeadEntry, SocialLeadEvidence, socialLeadEntry |
| [`bridge/shared/social-sales.ts`](../bridge/shared/social-sales.ts) | SocialSalesIntent, SocialMenuAction, SocialDetailAction, inferSocialSalesIntent, inferSocialMenuAction, inferSocialDetailAction, socialSalesClaimKey, salesWhatsAppUrl, salesContactImageFallback, SOCIAL_INFO_TEXT; +1 |
| [`bridge/shared/social-window-hold.ts`](../bridge/shared/social-window-hold.ts) | WINDOW_HOLD_FLAG, WINDOW_CLOSED_REASON, isN8nManagedFunnel, rebaseWindowHeldRows, holdSocialWindowMessages, resumeWindowHeldMessages |
| [`bridge/shared/social.ts`](../bridge/shared/social.ts) | commentReplyPath, SocialCommentInbound, commentContactExternalId, withMetaCursor, parseSocialCommentChanges |
| [`bridge/shared/stop-contact.ts`](../bridge/shared/stop-contact.ts) | stopContactAutomation, excludePaidContact |
| [`bridge/shared/supabase.ts`](../bridge/shared/supabase.ts) | DbClient, publicTable, publicRpc, admin, claimDelivery, claimDeliveryWithTtl, releaseDelivery, releaseDeliveryIfOlderThan |
| [`bridge/shared/sync-out-state.ts`](../bridge/shared/sync-out-state.ts) | readSyncOutState, writeSyncOutState, syncOutSinceMinutes |
| [`bridge/shared/uazapi-video-status.ts`](../bridge/shared/uazapi-video-status.ts) | ConfirmedVideoNotice, confirmedVideoNotice |
| [`bridge/shared/uazapi.ts`](../bridge/shared/uazapi.ts) | UazapiResponseError, uazapiConfigured, adminGet, adminPost, instGet, instPost, instPut, instDelete, listInstances, tokenForInstance |
| [`bridge/shared/unconfirmed-video-continuation.ts`](../bridge/shared/unconfirmed-video-continuation.ts) | isAwaitingVideoReceipt, allowsContinuationAfterUnconfirmedVideo |
| [`bridge/shared/webhook-url.ts`](../bridge/shared/webhook-url.ts) | ehNossoWebhook, tokenDoWebhook |
| [`bridge/shared/window.ts`](../bridge/shared/window.ts) | WINDOW_24H_MS, WINDOW_72H_MS, temJanelaMeta, WindowState, windowState |

## Páginas do painel (23)

| Arquivo | Papel / cautela |
|---|---|
| [`web/app/acompanhamento/page.jsx`](../web/app/acompanhamento/page.jsx) | rota do painel: `/acompanhamento` |
| [`web/app/analytics/page.jsx`](../web/app/analytics/page.jsx) | rota do painel: `/analytics` |
| [`web/app/backup/page.jsx`](../web/app/backup/page.jsx) | rota do painel: `/backup` |
| [`web/app/campanhas/page.jsx`](../web/app/campanhas/page.jsx) | rota do painel: `/campanhas` |
| [`web/app/central/page.jsx`](../web/app/central/page.jsx) | rota do painel: `/central` |
| [`web/app/clientes/page.jsx`](../web/app/clientes/page.jsx) | rota do painel: `/clientes` |
| [`web/app/conexoes/page.jsx`](../web/app/conexoes/page.jsx) | rota do painel: `/conexoes` |
| [`web/app/contatos/page.jsx`](../web/app/contatos/page.jsx) | rota do painel: `/contatos` |
| [`web/app/conversas/page.jsx`](../web/app/conversas/page.jsx) | rota do painel: `/conversas` |
| [`web/app/disparos/page.jsx`](../web/app/disparos/page.jsx) | rota do painel: `/disparos` |
| [`web/app/eventos/page.jsx`](../web/app/eventos/page.jsx) | rota do painel: `/eventos` |
| [`web/app/ferramentas/page.jsx`](../web/app/ferramentas/page.jsx) | rota do painel: `/ferramentas` |
| [`web/app/fluxos/page.jsx`](../web/app/fluxos/page.jsx) | rota do painel: `/fluxos` |
| [`web/app/funil/page.jsx`](../web/app/funil/page.jsx) | rota do painel: `/funil` |
| [`web/app/grupos/page.jsx`](../web/app/grupos/page.jsx) | rota do painel: `/grupos` |
| [`web/app/hibridos/page.jsx`](../web/app/hibridos/page.jsx) | rota do painel: `/hibridos` |
| [`web/app/instancias/page.jsx`](../web/app/instancias/page.jsx) | rota do painel: `/instancias` |
| [`web/app/login/page.jsx`](../web/app/login/page.jsx) | rota do painel: `/login` |
| [`web/app/orquestracao/page.jsx`](../web/app/orquestracao/page.jsx) | rota do painel: `/orquestracao` |
| [`web/app/page.jsx`](../web/app/page.jsx) | rota do painel: `/` |
| [`web/app/reativacao/page.jsx`](../web/app/reativacao/page.jsx) | rota do painel: `/reativacao` |
| [`web/app/relatorio/page.jsx`](../web/app/relatorio/page.jsx) | rota do painel: `/relatorio` |
| [`web/app/tecnologias/page.jsx`](../web/app/tecnologias/page.jsx) | rota do painel: `/tecnologias` |

## Migrations (22)

| Arquivo | Papel / cautela |
|---|---|
| [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0002_llm_orchestration.sql`](../supabase/migrations/0002_llm_orchestration.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0003_clientes.sql`](../supabase/migrations/0003_clientes.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0003_llm_prompt_cache_metrics.sql`](../supabase/migrations/0003_llm_prompt_cache_metrics.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0004_customer_identity.sql`](../supabase/migrations/0004_customer_identity.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0004_messages_wamid_uniq.sql`](../supabase/migrations/0004_messages_wamid_uniq.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0004_set_luna_as_default.sql`](../supabase/migrations/0004_set_luna_as_default.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0005_channels_external_id_uniq.sql`](../supabase/migrations/0005_channels_external_id_uniq.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0005_customer_identity_phone_repair.sql`](../supabase/migrations/0005_customer_identity_phone_repair.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0006_janela_origem_pricing.sql`](../supabase/migrations/0006_janela_origem_pricing.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0007_lead_attribution_monitoring.sql`](../supabase/migrations/0007_lead_attribution_monitoring.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0008_catalog_orders.sql`](../supabase/migrations/0008_catalog_orders.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0009_leads_qualification_planting_label.sql`](../supabase/migrations/0009_leads_qualification_planting_label.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0010_catalog_journey_prices.sql`](../supabase/migrations/0010_catalog_journey_prices.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0011_first_response_trigger.sql`](../supabase/migrations/0011_first_response_trigger.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0012_message_funnel_link.sql`](../supabase/migrations/0012_message_funnel_link.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0013_bot_mute.sql`](../supabase/migrations/0013_bot_mute.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0013_events_retention_index.sql`](../supabase/migrations/0013_events_retention_index.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0014_flow_state.sql`](../supabase/migrations/0014_flow_state.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0015_campaign_queue.sql`](../supabase/migrations/0015_campaign_queue.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0016_rls_campaign_and_clientes.sql`](../supabase/migrations/0016_rls_campaign_and_clientes.sql) | migration SQL; conferir ordem e registro de aplicação |
| [`supabase/migrations/0017_campaign_number_rotation.sql`](../supabase/migrations/0017_campaign_number_rotation.sql) | migration SQL; conferir ordem e registro de aplicação |

## Utilitários ops (20)

| Arquivo | Papel / cautela |
|---|---|
| [`ops/audit-3524-provider-opening.ts`](../ops/audit-3524-provider-opening.ts) | efeito a conferir no código antes de executar |
| [`ops/audit-5895-ads-seven-days.ts`](../ops/audit-5895-ads-seven-days.ts) | efeito a conferir no código antes de executar |
| [`ops/audit-5895-provider-first-phase.ts`](../ops/audit-5895-provider-first-phase.ts) | efeito a conferir no código antes de executar |
| [`ops/backup-evohub.ps1`](../ops/backup-evohub.ps1) | efeito a conferir no código antes de executar |
| [`ops/export-evohub-rest.ts`](../ops/export-evohub-rest.ts) | efeito a conferir no código antes de executar |
| [`ops/export-soberano-5895-funil.ts`](../ops/export-soberano-5895-funil.ts) | efeito a conferir no código antes de executar |
| [`ops/migrate-funil-5895-restored.ts`](../ops/migrate-funil-5895-restored.ts) | efeito a conferir no código antes de executar |
| [`ops/prepare-isca-campaign.mjs`](../ops/prepare-isca-campaign.mjs) | efeito a conferir no código antes de executar |
| [`ops/prepare-isca-campaign.test.mjs`](../ops/prepare-isca-campaign.test.mjs) | efeito a conferir no código antes de executar |
| [`ops/prepare-reativacao-campaign.mjs`](../ops/prepare-reativacao-campaign.mjs) | efeito a conferir no código antes de executar |
| [`ops/reanchor-5895-pending.ts`](../ops/reanchor-5895-pending.ts) | efeito a conferir no código antes de executar |
| [`ops/reconcile-3402-video.ts`](../ops/reconcile-3402-video.ts) | efeito a conferir no código antes de executar |
| [`ops/reconcile-3501-phase3-video.ts`](../ops/reconcile-3501-phase3-video.ts) | efeito a conferir no código antes de executar |
| [`ops/reconcile-3527-phase1-video.ts`](../ops/reconcile-3527-phase1-video.ts) | efeito a conferir no código antes de executar |
| [`ops/reconcile-5895-uncertain.ts`](../ops/reconcile-5895-uncertain.ts) | efeito a conferir no código antes de executar |
| [`ops/recover-3511-logistics.ts`](../ops/recover-3511-logistics.ts) | efeito a conferir no código antes de executar |
| [`ops/run-ad-funnel-watchdog-5895.ts`](../ops/run-ad-funnel-watchdog-5895.ts) | efeito a conferir no código antes de executar |
| [`ops/schedule-3511-logistics-answer.ts`](../ops/schedule-3511-logistics-answer.ts) | efeito a conferir no código antes de executar |
| [`ops/set-5895-ramp-restart.mjs`](../ops/set-5895-ramp-restart.mjs) | efeito a conferir no código antes de executar |
| [`ops/update-evohub-nginx-upstream.sh`](../ops/update-evohub-nginx-upstream.sh) | efeito a conferir no código antes de executar |

## Manutenção

Ao criar, remover ou renomear arquivo, atualize este catálogo e o índice. Para confirmar efeito de uma função, leia seu corpo, testes e consumidores; exports sozinhos não mostram dependências nem efeitos colaterais.
