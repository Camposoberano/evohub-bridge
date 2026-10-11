// Conteúdo do nó "Artes e opções de preço" do workflow n8n Soberano 5895 — Preço.
const request = $input.first().json.body;
if (!request || request.action !== 'preco' || request.funnel_version !== 'mega-sorgo-5895-20260930') {
  throw new Error('Ação ou versão inválida');
}

// Edite os valores aqui. Não inclua promoção, desconto ou frete sem nova aprovação.
const packages = {
  tam_2kg: { area: '½ hectare', kg: 2, price: 'R$ 179,90', slot: 'preco_2kg' },
  tam_4kg: { area: '1 hectare', kg: 4, price: 'R$ 341,62', slot: 'preco_4kg' },
  tam_10kg: { area: '2 hectares', kg: 10, price: 'R$ 764,15', slot: 'preco_10kg' },
  tam_20kg: { area: '4 hectares', kg: 20, price: 'R$ 1.437,90', slot: 'preco_20kg' },
};

const priceMenu = {
  day: 0,
  type: 'list',
  payload: {
    text: '🌱 *Mega Sorgo Santa Elisa* — escolha a área para ver o pacote e o valor. Para áreas acima de 4 hectares, informe a área e sua cidade/UF.',
    button_label: 'Escolher pacote',
    sections: [{
      title: 'Pacotes e valores',
      rows: Object.entries(packages).map(([id, item]) => ({
        id,
        title: item.area,
        description: `${item.kg} kg • ${item.price}`,
      })),
    }],
  },
  offset_seconds: 0,
};

function selectedPackage(id) {
  const item = packages[id];
  if (!item) throw new Error('Pacote desconhecido');
  return {
    day: 0,
    type: 'interactive',
    payload: {
      text: `🌱 *${item.kg} kg — até ${item.area}*\n💰 *${item.price}*\n\nQuer que o Cícero confirme a cotação para sua região?`,
      header_media_ref: { day: 0, slot: item.slot },
      buttons: [
        { id: `preco_cotar_${id}`, title: 'Pedir cotação' },
        { id: 'preco_tamanho', title: 'Outro pacote' },
      ],
    },
    offset_seconds: 0,
  };
}

function textPiece(content) {
  return { day: 0, type: 'text', payload: { content }, offset_seconds: 0 };
}

const paymentMenu = {
  day: 0,
  type: 'interactive',
  payload: {
    text: '💳 *Como o senhor prefere pagar?*',
    buttons: [
      { id: 'pag_pix', title: 'PIX' },
      { id: 'pag_cartao', title: 'Cartão' },
      { id: 'pag_boleto', title: 'Boleto' },
    ],
  },
  offset_seconds: 0,
};

let pieces;
const selected = request.selection;
if (!selected || selected === 'preco_tamanho') {
  pieces = [priceMenu];
} else if (Object.prototype.hasOwnProperty.call(packages, selected)) {
  pieces = [selectedPackage(selected)];
} else if (selected.startsWith('uso_')) {
  const useText = { uso_silagem: 'silagem', uso_pastejo: 'pastejo', uso_outro: 'essa finalidade' }[selected];
  if (!useText) throw new Error('Finalidade desconhecida');
  pieces = [
    textPiece(`Entendi: o senhor pretende usar para ${useText}. Vou te mostrar as opções de área e volume.`),
    { ...priceMenu, offset_seconds: 70 },
  ];
} else if (selected.startsWith('preco_cotar_')) {
  const id = selected.slice('preco_cotar_'.length);
  const item = packages[id];
  if ((!item && id !== 'tam_mais20kg') || typeof request.quote_registered !== 'boolean') {
    throw new Error('Cotação sem pacote ou estado de registro');
  }
  const label = item ? `${item.kg} kg (${item.area})` : 'área acima de 4 hectares';
  const amount = item ? ` Valor atual: ${item.price}.` : '';
  pieces = [textPiece(request.quote_registered
    ? `✅ Seu pedido de cotação de ${label} foi registrado para atendimento.${amount} O Cícero confirma os detalhes de entrega para sua região.`
    : 'Não consegui confirmar o registro automático da cotação agora. Envie sua região nesta conversa para a equipe conferir o pedido.')];
} else {
  const replies = {
    preco_pagamento: [paymentMenu],
    preco_area_maior: [textPiece('Para áreas acima de 4 hectares, diga quantos hectares pretende plantar e seu município/UF. O Cícero confirma o volume e a cotação.')],
    tam_mais20kg: [textPiece('🌱 Para áreas acima de 4 hectares, informe sua área e município/UF. O Cícero confirma o volume e a cotação.')],
    pag_pix: [textPiece('💰 *PIX direto com a empresa.* O Cícero vai confirmar os dados de pagamento para concluir seu pedido.')],
    pag_cartao: [textPiece('💳 *Cartão de crédito ou débito.* O Cícero vai enviar o link do site; confira as condições no checkout antes de confirmar.')],
    pag_boleto: [textPiece('📄 *Boleto bancário.* O Cícero vai enviar o link para gerar o boleto; confira as condições no checkout.')],
    preco_comprar: [textPiece('🤝 *Fechado!* O Cícero vai chamar você para concluir o pedido e confirmar os detalhes de entrega e pagamento.')],
  };
  pieces = replies[selected];
  if (!pieces) throw new Error('Resposta de preço desconhecida');
}

return [{ json: { request, pieces } }];
