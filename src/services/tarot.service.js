const cards = require('../data/cards.json');

function getRandomCard() {
  const index = Math.floor(Math.random() * cards.length);
  return cards[index];
}

function getTarotSimOuNao() {
  const card = getRandomCard();

  return {
    carta: card.name,
    resposta: card.answer,
    significado: card.meaning
  };
}

module.exports = {
  getTarotSimOuNao
};

