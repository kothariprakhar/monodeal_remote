
import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Card } from "../types";

export interface AIMove {
  action: 'BANK' | 'PROPERTY' | 'ACTION_PLAY' | 'END_TURN';
  cardId?: string;
}

export const getAIMoves = async (gameState: GameState): Promise<AIMove[]> => {
  // Create a new GoogleGenAI instance right before the call to ensure up-to-date config
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const opponent = gameState.players[1 - gameState.activePlayerIndex];
  
  // Clean data for prompt
  const handSummary = activePlayer.hand.map(c => ({ id: c.id, name: c.name, type: c.type, value: c.value }));
  const myProps = activePlayer.properties.map(p => ({ color: p.color, count: p.cards.length, isComplete: p.isComplete }));
  const oppProps = opponent.properties.map(p => ({ color: p.color, count: p.cards.length, isComplete: p.isComplete }));

  const prompt = `
    You are an expert AI playing Monopoly Deal. 
    Current Turn: ${activePlayer.name}
    Actions Remaining: ${gameState.actionsRemaining}
    
    Your Hand: ${JSON.stringify(handSummary)}
    Your Assets: 
    - Bank: ${activePlayer.bank.reduce((s, c) => s + c.value, 0)}M
    - Properties: ${JSON.stringify(myProps)}
    
    Opponent Assets:
    - Bank: ${opponent.bank.reduce((s, c) => s + c.value, 0)}M
    - Properties: ${JSON.stringify(oppProps)}

    Rules & Strategy:
    1. You can perform UP TO ${gameState.actionsRemaining} actions.
    2. Action types:
       - "BANK": Put a card (Money or Action) into your bank.
       - "PROPERTY": Put a Property or Wildcard into your property sets.
       - "ACTION_PLAY": Play an action card for its effect (e.g., Pass Go to draw cards).
    3. Goal: Complete 3 property sets to win.
    4. Prioritize building sets. Bank money if you need protection.
    5. ONLY use cardIds that are present in "Your Hand".

    Return a JSON array of moves (max ${gameState.actionsRemaining} moves).
    Example: [{"action": "PROPERTY", "cardId": "id-123"}, {"action": "BANK", "cardId": "id-456"}]
  `;

  try {
    const response = await ai.models.generateContent({
      // Strategy games involve advanced reasoning, so Pro model is preferred.
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ['BANK', 'PROPERTY', 'ACTION_PLAY', 'END_TURN'] },
              cardId: { type: Type.STRING }
            },
            required: ['action']
          }
        }
      }
    });

    // Directly access .text property and trim whitespace as per guidelines
    const jsonStr = response.text?.trim() || '[]';
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("AI Generation Error:", error);
    return [{ action: 'END_TURN' }];
  }
};
