import React, { useState, useEffect, useCallback, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { GameState, Player, Card, GamePhase, SET_LIMITS, PropertySet, RENT_VALUES } from './types';
import CardUI from './components/CardUI';
import { INITIAL_DECK as RAW_DECK } from './constants';
import { getAIMoves } from './services/geminiAi';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [lobbyMode, setLobbyMode] = useState<'MAIN' | 'HOST' | 'JOIN'>('MAIN');
  const [peerId, setPeerId] = useState<string>('');
  const [joinId, setJoinId] = useState<string>('');
  const [multiStatus, setMultiStatus] = useState<string>('');
  
  // Interaction states
  const [pendingRentCard, setPendingRentCard] = useState<Card | null>(null);
  const [pendingForceDeal, setPendingForceDeal] = useState<{ card: Card, mySetIndex?: number } | null>(null);
  const [pendingSlyDeal, setPendingSlyDeal] = useState<{ card: Card } | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const aiProcessingRef = useRef(false);
  const gameStateRef = useRef<GameState | null>(null);

  // Keep ref in sync with state for async access
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // --- Core Engine Helpers ---

  const shuffle = useCallback(<T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
  }, []);

  const syncState = useCallback((state: GameState) => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: 'STATE_UPDATE', state });
    }
  }, []);

  const initializeGame = useCallback((vsAI: boolean = true, isMultiplayer: boolean = false) => {
    const deck = shuffle([...RAW_DECK]);
    const player1Hand = deck.splice(0, 5);
    const player2Hand = deck.splice(0, 5);

    const newState: GameState = {
      players: [
        { id: 'p1', name: isMultiplayer ? 'Host' : 'Player 1', hand: player1Hand, bank: [], properties: [], isAI: false },
        { id: 'p2', name: vsAI ? 'Gemini AI' : (isMultiplayer ? 'Guest' : 'Player 2'), hand: player2Hand, bank: [], properties: [], isAI: vsAI }
      ],
      activePlayerIndex: 0,
      deck: deck,
      discardPile: [],
      phase: 'START_TURN',
      actionsRemaining: 3,
      logs: ['Game started! Master the market.'],
      winner: null,
      multiplayerRole: isMultiplayer ? 'HOST' : undefined,
      pendingAction: null
    };

    setGameState(newState);
    if (isMultiplayer) syncState(newState);
  }, [shuffle, syncState]);

  // --- Multiplayer Logic ---

  // Setup connection handlers
  const setupConnection = useCallback((conn: DataConnection, mode: 'HOST' | 'JOIN') => {
    conn.on('open', () => {
      setMultiStatus('Connected! Starting game...');
      if (mode === 'HOST') {
        // Allow connection to stabilize before syncing initial state
        setTimeout(() => initializeGame(false, true), 500);
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'STATE_UPDATE') {
        setGameState(data.state);
      }
    });

    conn.on('close', () => {
      setMultiStatus('Connection lost.');
      setGameState(null);
      setLobbyMode('MAIN');
      setJoinId('');
    });

    conn.on('error', (err) => {
      console.error("Connection Error:", err);
      setMultiStatus(`Conn Error: ${err.type}`);
    });
  }, [initializeGame]);

  const initMultiplayer = useCallback((mode: 'HOST' | 'JOIN') => {
    // Cleanup old peer if exists
    if (peerRef.current) {
        peerRef.current.destroy();
    }

    const customId = mode === 'HOST' ? Math.random().toString(36).substring(2, 7).toUpperCase() : undefined;
    const peer = new Peer(customId);
    peerRef.current = peer;

    setMultiStatus(mode === 'HOST' ? 'Waiting for player to join...' : 'Initializing...');

    peer.on('open', (id) => {
      setPeerId(id);
      if (mode === 'JOIN') {
        setMultiStatus('Ready to connect. Enter code.');
      }
    });

    peer.on('connection', (conn) => {
      // Host receives connection
      connRef.current = conn;
      setupConnection(conn, 'HOST');
    });

    peer.on('error', (err) => {
      console.error("Peer Error:", err);
      setMultiStatus(`Peer Error: ${err.type}`);
    });
  }, [setupConnection]);

  const connectToHost = () => {
    if (!joinId || !peerRef.current) return;
    setMultiStatus('Connecting to host...');
    
    try {
        const conn = peerRef.current.connect(joinId.trim().toUpperCase(), { serialization: 'json' });
        if (!conn) {
             setMultiStatus('Connection failed to initialize.');
             return;
        }
        connRef.current = conn;
        setupConnection(conn, 'JOIN');
    } catch (e) {
        console.error(e);
        setMultiStatus('Connection exception.');
    }
  };

  // --- Core Engine ---

  const checkWinCondition = (state: GameState): boolean => {
    const player = state.players[state.activePlayerIndex];
    const fullSets = player.properties.filter(p => p.isComplete).length;
    if (fullSets >= 3) {
      state.winner = player.name;
      state.phase = 'GAME_OVER';
      return true;
    }
    return false;
  };

  const processPayment = (fromPlayer: Player, toPlayer: Player, amount: number, log: string[]) => {
    let remaining = amount;
    
    // 1. Prioritize paying with the smallest bank cards first
    fromPlayer.bank.sort((a, b) => a.value - b.value);
    
    while (remaining > 0 && fromPlayer.bank.length > 0) {
      const card = fromPlayer.bank.shift()!; // Shift takes the smallest since we sorted asc
      toPlayer.bank.push(card);
      remaining -= card.value;
      log.unshift(`${fromPlayer.name} paid ${card.name} (${card.value}M) from bank.`);
      if (remaining < 0) {
        log.unshift(`Note: No change is given in MonoDeal!`);
      }
    }
    
    // 2. If debt still remains, pay with properties
    while (remaining > 0 && fromPlayer.properties.length > 0) {
      const setIdx = fromPlayer.properties.findIndex(p => p.cards.length > 0);
      if (setIdx === -1) break;
      
      const card = fromPlayer.properties[setIdx].cards.pop()!;
      // Breaking a set or cleaning up
      if (fromPlayer.properties[setIdx].cards.length === 0) {
        fromPlayer.properties.splice(setIdx, 1);
      } else {
        fromPlayer.properties[setIdx].isComplete = false;
      }
      
      let targetColor = card.color || 'ANY';
      let targetSet = toPlayer.properties.find(p => p.color === targetColor);
      if (!targetSet) {
        targetSet = { color: targetColor as any, cards: [], isComplete: false };
        toPlayer.properties.push(targetSet);
      }
      targetSet.cards.push(card);
      targetSet.isComplete = targetSet.cards.length >= SET_LIMITS[targetSet.color];
      
      remaining -= card.value;
      log.unshift(`${fromPlayer.name} surrendered property ${card.name} to settle debt.`);
    }
  };

  const handleRentCollection = (setIndex: number) => {
    if (!pendingRentCard || !gameState) return;

    setGameState(prev => {
      if (!prev) return prev;
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const player = newState.players[newState.activePlayerIndex];
      const opponent = newState.players[1 - newState.activePlayerIndex];
      const targetSet = player.properties[setIndex];

      const rentArr = RENT_VALUES[targetSet.color];
      const count = Math.min(targetSet.cards.length, rentArr.length);
      const rentVal = rentArr[count - 1] || 0;

      newState.logs.unshift(`${player.name} collected ${rentVal}M rent for ${targetSet.color} set.`);
      processPayment(opponent, player, rentVal, newState.logs);
      
      newState.discardPile.push(pendingRentCard);
      newState.actionsRemaining -= 1;
      
      checkWinCondition(newState);
      if (connRef.current) syncState(newState);
      return newState;
    });

    setPendingRentCard(null);
    setSelectedCardId(null);
  };

  const resolvePendingAction = useCallback((useJSN: boolean) => {
    setGameState(prev => {
      if (!prev || !prev.pendingAction) return prev;
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const { type, card, attackerIndex } = newState.pendingAction;
      const currentJsnStack = newState.pendingAction.jsnStack || 0;
      
      // Determine who is playing JSN (if useJSN is true)
      // Even stack (0, 2) -> Defender turn to JSN
      // Odd stack (1, 3) -> Attacker turn to JSN (counter)
      const isDefenderTurn = currentJsnStack % 2 === 0;
      const playerIndex = isDefenderTurn ? (1 - attackerIndex) : attackerIndex;
      const player = newState.players[playerIndex];

      if (useJSN) {
        const jsnIndex = player.hand.findIndex(c => c.name === 'Just Say No');
        if (jsnIndex !== -1) {
          const jsnCard = player.hand.splice(jsnIndex, 1)[0];
          newState.discardPile.push(jsnCard);
          
          // Increment stack
          newState.pendingAction.jsnStack = currentJsnStack + 1;
          newState.logs.unshift(`${player.name} used JUST SAY NO! (Chain: ${currentJsnStack + 1})`);
          
          if (connRef.current) syncState(newState);
          return newState; // Return early, waiting for next JSN response
        }
      } 
      
      // If user declined JSN (or didn't have one), check if action is blocked
      // Blocked if stack is ODD (1, 3, 5...)
      const actionBlocked = currentJsnStack % 2 === 1;

      if (actionBlocked) {
          newState.logs.unshift(`Action ${card.name} blocked by Just Say No.`);
          newState.discardPile.push(card);
          newState.pendingAction = null;
          newState.actionsRemaining -= 1; // Action card still consumes action
          if (connRef.current) syncState(newState);
          return newState;
      }

      // If we are here, action executes (Stack is 0 or Even)
      const attacker = newState.players[attackerIndex];
      const opponent = newState.players[1 - attackerIndex];

      if (type === 'FORCE_DEAL') {
          if (newState.pendingAction.mySetIndex !== undefined && newState.pendingAction.targetSetIndex !== undefined) {
             const mySet = attacker.properties[newState.pendingAction.mySetIndex];
             const oppSet = opponent.properties[newState.pendingAction.targetSetIndex];
             
             if (mySet && oppSet && mySet.cards.length > 0 && oppSet.cards.length > 0) {
                const myCard = mySet.cards.pop()!;
                const oppCard = oppSet.cards.pop()!;
                
                if (mySet.cards.length === 0) attacker.properties.splice(newState.pendingAction.mySetIndex, 1);
                else mySet.isComplete = false;
                
                // Note: opponent index might shift if attacker removed set (different arrays so safeish, but be careful with indices if same array, here different players)
                if (oppSet.cards.length === 0) opponent.properties.splice(newState.pendingAction.targetSetIndex, 1);
                else oppSet.isComplete = false;

                // Smart placement logic
                const placeCard = (p: Player, c: Card) => {
                   let targetColor = c.color || 'ANY';
                   let target = p.properties.find(set => set.color === targetColor && !set.isComplete);
                   if (!target && c.secondaryColor) target = p.properties.find(set => set.color === c.secondaryColor && !set.isComplete);
                   if (!target) target = p.properties.find(set => set.color === targetColor); // Fallback to complete
                   if (!target) {
                     target = { color: targetColor as any, cards: [], isComplete: false };
                     p.properties.push(target);
                   }
                   target.cards.push(c);
                   target.isComplete = target.cards.length >= SET_LIMITS[target.color];
                };

                placeCard(attacker, oppCard);
                placeCard(opponent, myCard);
                newState.logs.unshift(`${attacker.name} played Force Deal: Swapped ${myCard.name} for ${oppCard.name}.`);
             }
          }
      } else if (type === 'SLY_DEAL') {
          // Logic for Sly Deal with specific target set
          if (newState.pendingAction.targetSetIndex !== undefined) {
             const targetSet = opponent.properties[newState.pendingAction.targetSetIndex];
             // Sly deal cannot steal from complete sets (validated in UI/AI choice, but check again)
             if (targetSet && !targetSet.isComplete && targetSet.cards.length > 0) {
                 const stolen = targetSet.cards.pop()!;
                 if (targetSet.cards.length === 0) opponent.properties.splice(newState.pendingAction.targetSetIndex, 1);
                 else targetSet.isComplete = false;

                 // Give to attacker
                 let targetColor = stolen.color || 'ANY';
                 let mySet = attacker.properties.find(p => p.color === targetColor && !p.isComplete);
                 if (!mySet && stolen.secondaryColor) mySet = attacker.properties.find(p => p.color === stolen.secondaryColor && !p.isComplete);
                 if (!mySet) {
                    mySet = { color: targetColor as any, cards: [], isComplete: false };
                    attacker.properties.push(mySet);
                 }
                 mySet.cards.push(stolen);
                 mySet.isComplete = mySet.cards.length >= SET_LIMITS[mySet.color];
                 newState.logs.unshift(`${attacker.name} stole ${stolen.name} with Sly Deal.`);
             } else {
                newState.logs.unshift(`${attacker.name} tried Sly Deal but target was invalid.`);
             }
          }
      } else if (type === 'DEAL_BREAKER') {
          // Auto-select first complete set for now (could be targeted too)
          const stealableSets = opponent.properties.filter(p => p.isComplete);
          if (stealableSets.length > 0) {
            const targetSet = stealableSets[0];
            opponent.properties = opponent.properties.filter(p => p !== targetSet);
            attacker.properties.push(targetSet);
            newState.logs.unshift(`${attacker.name} played Deal Breaker: Stole a complete ${targetSet.color} set!`);
          }
      } else if (type === 'DEBT_COLLECTOR') {
          newState.logs.unshift(`${attacker.name} used Debt Collector: ${opponent.name} owes 5M.`);
          processPayment(opponent, attacker, 5, newState.logs);
      } else if (type === 'BIRTHDAY') {
          newState.logs.unshift(`${attacker.name} used It's My Birthday! ${opponent.name} owes 2M.`);
          processPayment(opponent, attacker, 2, newState.logs);
      }
      
      newState.discardPile.push(card);
      newState.actionsRemaining -= 1;
      newState.pendingAction = null;
      checkWinCondition(newState);
      if (connRef.current) syncState(newState);
      return newState;
    });
  }, [syncState]);

  const initiateForceDeal = (targetSetIndex: number) => {
    setGameState(prev => {
       if (!prev || !pendingForceDeal || pendingForceDeal.mySetIndex === undefined) return prev;
       const newState = JSON.parse(JSON.stringify(prev)) as GameState;
       
       newState.pendingAction = {
         type: 'FORCE_DEAL',
         card: pendingForceDeal.card,
         attackerIndex: newState.activePlayerIndex,
         mySetIndex: pendingForceDeal.mySetIndex,
         targetSetIndex: targetSetIndex,
         jsnStack: 0
       };

       if (connRef.current) syncState(newState);
       return newState;
    });
    setPendingForceDeal(null);
  };

  const initiateSlyDeal = (targetSetIndex: number) => {
    setGameState(prev => {
       if (!prev || !pendingSlyDeal) return prev;
       const newState = JSON.parse(JSON.stringify(prev)) as GameState;
       
       newState.pendingAction = {
         type: 'SLY_DEAL',
         card: pendingSlyDeal.card,
         attackerIndex: newState.activePlayerIndex,
         targetSetIndex: targetSetIndex,
         jsnStack: 0
       };

       if (connRef.current) syncState(newState);
       return newState;
    });
    setPendingSlyDeal(null);
  };

  const executeMove = useCallback((type: 'BANK' | 'PROPERTY' | 'ACTION_PLAY', cardId: string) => {
    setGameState(prev => {
      if (!prev || prev.actionsRemaining <= 0 || prev.phase !== 'PLAY_PHASE' || prev.winner || prev.pendingAction) return prev;
      
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const player = newState.players[newState.activePlayerIndex];
      const opponent = newState.players[1 - newState.activePlayerIndex];
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      
      if (cardIndex === -1) return prev;
      const card = player.hand[cardIndex];

      switch (type) {
        case 'BANK':
          player.hand.splice(cardIndex, 1);
          player.bank.push(card);
          newState.logs.unshift(`${player.name} banked ${card.name} (${card.value}M).`);
          newState.actionsRemaining -= 1;
          break;
        case 'PROPERTY':
          if (card.type !== 'PROPERTY' && card.type !== 'WILD') return prev;
          player.hand.splice(cardIndex, 1);
          const color = card.color || 'ANY';
          let set = player.properties.find(p => p.color === color);
          if (!set) {
            set = { color: color as any, cards: [], isComplete: false };
            player.properties.push(set);
          }
          set.cards.push(card);
          set.isComplete = set.cards.length >= SET_LIMITS[set.color];
          newState.logs.unshift(`${player.name} deployed ${card.name}.`);
          newState.actionsRemaining -= 1;
          break;
        case 'ACTION_PLAY':
          if (card.type === 'RENT') {
            player.hand.splice(cardIndex, 1);
            setPendingRentCard(card);
            return newState;
          }

          if (card.name === 'Force Deal') {
            player.hand.splice(cardIndex, 1);
            
            // AI Auto-Target for Force Deal
            if (player.isAI) {
               // Pick random non-complete set from me
               const myIndices = player.properties.map((p, i) => ({p, i})).filter(x => !x.p.isComplete && x.p.cards.length > 0);
               // Pick random non-complete set from opp
               const oppIndices = opponent.properties.map((p, i) => ({p, i})).filter(x => !x.p.isComplete && x.p.cards.length > 0);
               
               if (myIndices.length > 0 && oppIndices.length > 0) {
                 const myIdx = myIndices[Math.floor(Math.random() * myIndices.length)].i;
                 const oppIdx = oppIndices[Math.floor(Math.random() * oppIndices.length)].i;
                 newState.pendingAction = {
                    type: 'FORCE_DEAL',
                    card,
                    attackerIndex: newState.activePlayerIndex,
                    mySetIndex: myIdx,
                    targetSetIndex: oppIdx,
                    jsnStack: 0
                 };
               } else {
                 newState.logs.unshift("AI tried Force Deal but had no valid targets. Card wasted.");
                 newState.discardPile.push(card);
                 newState.actionsRemaining -= 1;
               }
            } else {
               setPendingForceDeal({ card });
            }
            return newState;
          }

          if (card.name === 'Sly Deal') {
            player.hand.splice(cardIndex, 1);

            // AI Auto-Target for Sly Deal
            if (player.isAI) {
               const oppIndices = opponent.properties.map((p, i) => ({p, i})).filter(x => !x.p.isComplete && x.p.cards.length > 0);
               if (oppIndices.length > 0) {
                  const oppIdx = oppIndices[Math.floor(Math.random() * oppIndices.length)].i;
                  newState.pendingAction = {
                     type: 'SLY_DEAL',
                     card,
                     attackerIndex: newState.activePlayerIndex,
                     targetSetIndex: oppIdx,
                     jsnStack: 0
                  };
               } else {
                  newState.logs.unshift("AI tried Sly Deal but nothing to steal. Card wasted.");
                  newState.discardPile.push(card);
                  newState.actionsRemaining -= 1;
               }
            } else {
               setPendingSlyDeal({ card });
            }
            return newState;
          }
          
          if (['Deal Breaker', 'Debt Collector', "It's My Birthday"].includes(card.name)) {
            player.hand.splice(cardIndex, 1);
            let actionType: any = card.name.toUpperCase().replace(' ', '_');
            if (card.name === "It's My Birthday") actionType = 'BIRTHDAY';
            
            newState.pendingAction = {
              type: actionType,
              card,
              attackerIndex: newState.activePlayerIndex,
              jsnStack: 0
            };
          } else {
            // General actions like Pass Go
            player.hand.splice(cardIndex, 1);
            if (card.name === 'Pass Go') {
               const drawn = newState.deck.splice(0, 2);
               player.hand.push(...drawn);
               newState.logs.unshift(`${player.name} played Pass Go: +2 cards.`);
            } else {
               newState.logs.unshift(`${player.name} played ${card.name}.`);
            }
            newState.discardPile.push(card);
            newState.actionsRemaining -= 1;
          }
          break;
      }

      checkWinCondition(newState);
      if (connRef.current) syncState(newState);
      return newState;
    });
    setSelectedCardId(null);
  }, [resolvePendingAction, syncState]);

  const startTurn = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'START_TURN') return prev;
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const player = newState.players[newState.activePlayerIndex];
      const drawCount = player.hand.length === 0 ? 5 : 2;
      const drawn = newState.deck.splice(0, drawCount);
      player.hand.push(...drawn);
      newState.actionsRemaining = 3;
      newState.phase = 'PLAY_PHASE';
      newState.logs.unshift(`${player.name} draws ${drawCount} cards.`);
      if (connRef.current) syncState(newState);
      return newState;
    });
  }, [syncState]);

  const endTurn = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'PLAY_PHASE') return prev;
      const nextIdx = (prev.activePlayerIndex + 1) % 2;
      const newState: GameState = {
        ...prev,
        activePlayerIndex: nextIdx,
        actionsRemaining: 3,
        phase: 'START_TURN',
        logs: [`Turn change: ${prev.players[nextIdx].name}'s turn.`, ...prev.logs]
      };
      if (connRef.current) syncState(newState);
      return newState;
    });
    setSelectedCardId(null);
    setPendingRentCard(null);
    setPendingForceDeal(null);
    setPendingSlyDeal(null);
  }, [syncState]);

  const handleCardClick = useCallback((cardId: string) => {
    if (gameState?.winner || pendingRentCard || gameState?.pendingAction || pendingForceDeal || pendingSlyDeal) return;
    setSelectedCardId(prev => (prev === cardId ? null : cardId));
  }, [gameState?.winner, pendingRentCard, gameState?.pendingAction, pendingForceDeal, pendingSlyDeal]);

  useEffect(() => {
    if (gameState?.phase === 'START_TURN') {
      const t = setTimeout(startTurn, 800);
      return () => clearTimeout(t);
    }
  }, [gameState?.phase, startTurn]);

  // AI Logic Loop
  useEffect(() => {
    if (
      gameState && 
      gameState.players[gameState.activePlayerIndex].isAI && 
      gameState.phase === 'PLAY_PHASE' && 
      !aiProcessingRef.current &&
      !gameState.winner &&
      !gameState.pendingAction
    ) {
      const runAI = async () => {
        aiProcessingRef.current = true;
        setIsProcessing(true);
        try {
          const moves = await getAIMoves(gameState);
          for (const move of moves) {
            const current = gameStateRef.current;
            if (!current) break; 
            if (current.actionsRemaining <= 0 || current.winner || current.pendingAction) break;
            if (move.action === 'END_TURN') break;
            
            if (move.cardId) {
              const canPlay = current.players[current.activePlayerIndex].hand.some(c => c.id === move.cardId);
              if (canPlay) {
                const type = move.action === 'ACTION_PLAY' ? 'ACTION_PLAY' : move.action === 'BANK' ? 'BANK' : 'PROPERTY';
                executeMove(type, move.cardId);
                await new Promise(r => setTimeout(r, 1500));
              }
            }
          }
        } finally {
           const current = gameStateRef.current;
           if (current && !current.winner && !current.pendingAction) {
             endTurn();
           }
           setIsProcessing(false);
           aiProcessingRef.current = false;
        }
      };
      runAI();
    }
  }, [gameState?.activePlayerIndex, gameState?.phase, executeMove, endTurn, gameState?.winner, gameState?.pendingAction]);

  // AI JSN Logic (Auto-Defend and Auto-Counter)
  const pendingJsnStack = gameState?.pendingAction?.jsnStack ?? 0;
  
  useEffect(() => {
    if (!gameState || !gameState.pendingAction) return;

    const jsnStack = gameState.pendingAction.jsnStack || 0;
    const isDefenderTurn = jsnStack % 2 === 0;
    const playerIndex = isDefenderTurn ? (1 - gameState.pendingAction.attackerIndex) : gameState.pendingAction.attackerIndex;
    const player = gameState.players[playerIndex];

    if (player.isAI) {
       const hasJSN = player.hand.some(c => c.name === 'Just Say No');
       const timer = setTimeout(() => {
         // AI always uses JSN if it has it to block/counter
         resolvePendingAction(hasJSN);
       }, 2000);
       return () => clearTimeout(timer);
    }
  }, [pendingJsnStack, resolvePendingAction, gameState]);

  // Helper for Fan Stack (Hand-like)
  const renderFanStack = (cards: Card[], size: 'sm' | 'md' = 'sm', className?: string) => {
    if (cards.length === 0) {
      return (
        <div className={`border-2 border-white/5 rounded-lg flex items-center justify-center opacity-20 ${size === 'md' ? 'w-24 h-36' : 'w-16 h-24'} ${className}`}>
           <span className="text-[9px]">EMPTY</span>
        </div>
      );
    }
    
    const count = cards.length;
    // Fan spread calculation (Hand-like arc)
    const maxSpread = 45; // reduced spread for tighter fan
    const spacing = Math.min(maxSpread / (count > 1 ? count - 1 : 1), 15);
    const totalSpread = (count - 1) * spacing;
    const startAngle = -totalSpread / 2;

    return (
      <div className={`relative group cursor-pointer ${className}`} style={{ width: size === 'md' ? '120px' : '80px', height: size === 'md' ? '160px' : '110px' }}>
        {cards.map((card, i) => {
          const angle = startAngle + (i * spacing);
          const isTop = i === count - 1;
          
          return (
            <div 
              key={card.id} 
              className="absolute bottom-0 left-1/2 origin-bottom transition-transform duration-300"
              style={{ 
                zIndex: i,
                transform: `translateX(-50%) rotate(${angle}deg) translateY(${i * -1}px)`,
              }}
            >
              <CardUI 
                card={card} 
                size={size} 
                // Only top card has full shadow to prevent accumulation, but all are opaque.
                // Lower cards are slightly dimmed via brightness filter for depth.
                className={`${isTop ? 'shadow-xl brightness-100' : 'shadow-none brightness-90'} border-slate-900/10`} 
                disabled // Used for interaction logic (no internal hover), opacity handled by lack of opacity class
              />
            </div>
          );
        })}
        {/* Total Value Badge for stacks */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-[60] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
           <span className="bg-slate-900/90 px-2 py-0.5 rounded text-[10px] font-bold text-white border border-white/20 whitespace-nowrap shadow-xl">
             {cards.length} Cards
           </span>
        </div>
      </div>
    );
  };

  if (!gameState) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white p-6 overflow-y-auto">
        <div className="relative mb-12 group">
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600 to-blue-600 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <div className="relative bg-slate-900 px-12 py-8 rounded-3xl border border-white/10 text-center">
            <h1 className="text-6xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 via-amber-500 to-orange-600 tracking-tighter italic">MONODEAL</h1>
            <p className="text-slate-500 font-bold uppercase tracking-[0.5em] text-xs">ChunkyMonkey Digital Edition</p>
          </div>
        </div>
        
        {lobbyMode === 'MAIN' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl animate-in fade-in zoom-in duration-500">
            <button onClick={() => initializeGame(true)} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-amber-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/20"><i className="fa-solid fa-robot text-slate-900 text-xl"></i></div>
              <h3 className="text-xl font-bold mb-1">VS Gemini AI</h3>
              <p className="text-slate-500 text-sm">Challenge the advanced AI on your own.</p>
            </button>
            <button onClick={() => { setLobbyMode('HOST'); initMultiplayer('HOST'); }} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-blue-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20"><i className="fa-solid fa-earth-americas text-white text-xl"></i></div>
              <h3 className="text-xl font-bold mb-1">Host Remote Game</h3>
              <p className="text-slate-500 text-sm">Create a room for your wife to join.</p>
            </button>
            <button onClick={() => { setLobbyMode('JOIN'); initMultiplayer('JOIN'); }} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-emerald-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20"><i className="fa-solid fa-key text-white text-xl"></i></div>
              <h3 className="text-xl font-bold mb-1">Join with Code</h3>
              <p className="text-slate-500 text-sm">Enter a room code from another player.</p>
            </button>
            <button onClick={() => initializeGame(false)} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-purple-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20"><i className="fa-solid fa-users text-white text-xl"></i></div>
              <h3 className="text-xl font-bold mb-1">Local 2 Player</h3>
              <p className="text-slate-500 text-sm">Pass and play on the same device.</p>
            </button>
          </div>
        )}

        {lobbyMode === 'HOST' && (
           <div className="text-center animate-in fade-in zoom-in duration-300">
             <h2 className="text-3xl font-black mb-6 text-amber-500 uppercase tracking-widest">Room Created</h2>
             <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 mb-6 relative group">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Share this Code</p>
                {peerId ? (
                   <div className="text-5xl font-black text-white tracking-widest select-all cursor-pointer hover:text-blue-400 transition" onClick={() => navigator.clipboard.writeText(peerId)}>
                      {peerId}
                   </div>
                ) : (
                   <div className="animate-pulse text-xl font-bold text-slate-500">Generating Code...</div>
                )}
                <div className="absolute inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition rounded-2xl pointer-events-none flex items-center justify-center">
                   <span className="text-blue-400 font-bold uppercase text-xs">Click to Copy</span>
                </div>
             </div>
             <p className="text-slate-500 text-sm font-bold uppercase tracking-widest animate-pulse mb-8">{multiStatus}</p>
             <button onClick={() => { setLobbyMode('MAIN'); if(peerRef.current) peerRef.current.destroy(); }} className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-sm text-white transition border border-white/10">CANCEL</button>
           </div>
        )}

        {lobbyMode === 'JOIN' && (
           <div className="text-center animate-in fade-in zoom-in duration-300 max-w-md w-full">
             <h2 className="text-3xl font-black mb-6 text-emerald-500 uppercase tracking-widest">Join Game</h2>
             <div className="mb-6">
                <input 
                  type="text" 
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  placeholder="ENTER ROOM CODE"
                  className="w-full bg-slate-800/50 border-2 border-slate-700 focus:border-emerald-500 rounded-2xl p-4 text-center text-3xl font-black text-white tracking-widest outline-none transition placeholder:text-slate-700 uppercase"
                  maxLength={5}
                />
             </div>
             <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-8 h-4">{multiStatus}</p>
             <div className="flex gap-4 justify-center">
               <button onClick={() => { setLobbyMode('MAIN'); if(peerRef.current) peerRef.current.destroy(); }} className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-sm text-white transition border border-white/10">CANCEL</button>
               <button onClick={connectToHost} disabled={!peerId || joinId.length < 5} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-sm text-white transition shadow-lg shadow-emerald-500/20">CONNECT</button>
             </div>
           </div>
        )}
      </div>
    );
  }

  // Determine role/view based on Multiplayer or Local Play status
  const isMultiplayer = !!gameState.multiplayerRole;
  
  let viewIndex = 0;
  if (isMultiplayer) {
      // Use local lobbyMode to determine view index (Host=0, Guest=1)
      viewIndex = lobbyMode === 'JOIN' ? 1 : 0;
  } else {
      // Local Play Logic: View follows action
      if (gameState.pendingAction) {
          const stack = gameState.pendingAction.jsnStack || 0;
          const att = gameState.pendingAction.attackerIndex;
          // Even stack: Opponent of attacker responds
          // Odd stack: Attacker responds (counter)
          viewIndex = stack % 2 === 0 ? (1 - att) : att;
      } else {
          viewIndex = gameState.activePlayerIndex;
      }
  }

  const myIndex = viewIndex;
  const opponentIndex = 1 - myIndex;
  
  const me = gameState.players[myIndex];
  const them = gameState.players[opponentIndex];
  const isMyTurn = gameState.activePlayerIndex === myIndex;
  const activePlayer = gameState.players[gameState.activePlayerIndex];

  const isValidRentTarget = (set: PropertySet) => {
    if (!pendingRentCard) return false;
    if (pendingRentCard.color === 'ANY') return true;
    return set.color === pendingRentCard.color || set.color === pendingRentCard.secondaryColor;
  };

  // Determine who needs to respond to JSN
  const jsnStack = gameState.pendingAction?.jsnStack || 0;
  // Explicitly calculate responder index based on stack depth
  const realResponderIndex = jsnStack % 2 === 0 ? (1 - (gameState.pendingAction?.attackerIndex || 0)) : (gameState.pendingAction?.attackerIndex || 0);
  
  // Show prompt if:
  // 1. Action is pending
  // 2. The current view (me) is the responder
  // 3. The responder is not AI
  const showJSNPrompt = gameState.pendingAction && (realResponderIndex === myIndex) && !me.isAI;

  const responderName = gameState.players[realResponderIndex].name;
  
  // Text for JSN Modal
  const getJsnPromptText = () => {
     if (!gameState.pendingAction) return "";
     const attackerName = gameState.players[gameState.pendingAction.attackerIndex].name;
     if (jsnStack === 0) {
        return `${attackerName} is playing ${gameState.pendingAction.card.name}!`;
     } else {
        const prevPlayer = gameState.players[1 - realResponderIndex].name;
        return `${prevPlayer} used JUST SAY NO!`;
     }
  };

  // Force Deal Helpers
  const isForceDealMyTurn = !!pendingForceDeal;
  const isSelectingMySet = isForceDealMyTurn && pendingForceDeal.mySetIndex === undefined;
  const isSelectingOppSet = isForceDealMyTurn && pendingForceDeal.mySetIndex !== undefined;

  // Sly Deal Helpers
  const isSlyDealMyTurn = !!pendingSlyDeal;

  return (
    <div className="h-screen bg-[#020617] flex flex-col overflow-hidden select-none text-slate-200">
      
      {/* HUD */}
      <div className="h-16 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-6 border-b border-white/5 z-20">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Turn Of</span>
            <span className={`font-black text-lg ${gameState.activePlayerIndex === 0 ? 'text-blue-400' : 'text-amber-400'}`}>
              {activePlayer.name.toUpperCase()} {isMyTurn ? '(YOU)' : ''}
            </span>
          </div>
          <div className="h-10 w-[1px] bg-white/10" />
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className={`w-3 h-3 rounded-full transition-all duration-500 ${i <= gameState.actionsRemaining ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' : 'bg-slate-700'}`} />
            ))}
            <span className="text-xs font-bold text-amber-500 ml-1 uppercase">{gameState.actionsRemaining} Actions Left</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex p-4 gap-4 overflow-hidden relative">
        
        {/* Left Panel: Opponent Assets (Them) */}
        <div className={`flex-1 flex flex-col rounded-[2.5rem] p-6 transition-all duration-700 overflow-y-auto custom-scrollbar bg-slate-900/40 border border-white/5 ${!isMyTurn && !showJSNPrompt ? 'ring-2 ring-amber-500/30' : ''}`}>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10"><i className="fa-solid fa-user-circle text-slate-400"></i></div>
              <span className="font-black text-xl tracking-tight uppercase opacity-50">{them.name}</span>
            </div>
            <div className="flex gap-4 items-center">
               {renderFanStack(them.bank, 'sm')}
               <div className="bg-amber-500/5 px-3 py-1 rounded-xl border border-amber-500/10 text-amber-500/60 font-bold text-sm h-fit">{them.properties.filter(p => p.isComplete).length}/3 SETS</div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
            {them.properties.map((set, i) => {
              const isTargetableFD = isSelectingOppSet && !set.isComplete;
              const isTargetableSD = isSlyDealMyTurn && !set.isComplete;
              return (
              <div 
                key={i} 
                onClick={() => {
                   if (isTargetableFD) initiateForceDeal(i);
                   if (isTargetableSD) initiateSlyDeal(i);
                }}
                className={`relative p-2 rounded-2xl transition-all 
                  ${set.isComplete ? 'scale-[1.02]' : ''}
                  ${(isTargetableFD || isTargetableSD) ? 'ring-4 ring-amber-500 cursor-pointer animate-pulse z-30' : ''}
                  ${(isSelectingOppSet || isSlyDealMyTurn) && !(isTargetableFD || isTargetableSD) ? 'opacity-30' : ''}
                `}
              >
                 {set.isComplete && (
                   <div className="absolute -top-2 -right-2 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center shadow-lg z-10 animate-bounce">
                     <i className="fa-solid fa-check text-white text-xs"></i>
                   </div>
                 )}
                 <div className="flex items-center justify-center h-36">
                    {renderFanStack(set.cards, 'md', 'mx-auto')}
                 </div>
                 {set.isComplete && <div className="text-center text-[10px] font-black text-amber-500 uppercase tracking-widest pb-1 mt-2">Full Set</div>}
              </div>
              );
            })}
          </div>
        </div>

        {/* Center: Deck & Discard */}
        <div className="w-32 flex flex-col items-center justify-center gap-8 py-10 z-0">
          {/* Draw Pile */}
          <div className="relative group cursor-pointer">
            <div className="w-24 h-36 bg-blue-800 rounded-xl border border-white/10 shadow-xl absolute top-1 left-1 rotate-3"></div>
            <div className="w-24 h-36 bg-blue-700 rounded-xl border border-white/10 shadow-xl absolute top-0.5 left-0.5 -rotate-2"></div>
            <div className="relative w-24 h-36 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl border border-white/20 shadow-2xl flex items-center justify-center">
              <span className="font-black text-3xl text-white drop-shadow-md">{gameState.deck.length}</span>
            </div>
          </div>

          {/* Discard Pile - Showing only the latest card with entrance animation */}
          <div className="relative w-32 h-48 flex items-center justify-center">
            {gameState.discardPile.length > 0 ? (
              <div 
                key={gameState.discardPile[gameState.discardPile.length - 1].id} 
                className="animate-in zoom-in-50 slide-in-from-bottom-24 duration-500 absolute inset-0"
              >
                 {/* Added shadow-2xl manually since default was removed */}
                 <CardUI card={gameState.discardPile[gameState.discardPile.length - 1]} size="lg" className="shadow-2xl" disabled />
                 {/* Pass Go Animation Overlay */}
                 {gameState.discardPile[gameState.discardPile.length - 1].name === 'Pass Go' && (
                   <div 
                     className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap z-50"
                     style={{ animation: 'bounce 1s infinite, fadeOut 2s forwards' }}
                   >
                     <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">+2 CARDS!</span>
                   </div>
                 )}
              </div>
            ) : (
              <div className="w-24 h-36 rounded-xl border-2 border-dashed border-white/5 flex items-center justify-center">
                 <span className="text-xs font-black text-white/10 uppercase -rotate-45">Discard</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Your Assets (Me) */}
        <div className={`flex-1 flex flex-col rounded-[2.5rem] p-6 transition-all duration-700 overflow-y-auto custom-scrollbar ${isMyTurn || showJSNPrompt ? 'bg-blue-600/5 border border-blue-500/30 ring-2 ring-blue-500/20' : 'bg-slate-900/40 border border-white/5'}`}>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${isMyTurn || showJSNPrompt ? 'bg-blue-600 border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'bg-slate-800 border-white/10'}`}><i className={`fa-solid fa-user ${isMyTurn || showJSNPrompt ? 'text-white' : 'text-slate-500'}`}></i></div>
              <span className="font-black text-xl tracking-tight uppercase tracking-widest">
                {pendingRentCard ? 'Select Rent Target' : pendingForceDeal ? 'Force Deal Mode' : pendingSlyDeal ? 'Sly Deal Mode' : isMyTurn ? 'Your Strategy' : (showJSNPrompt ? 'Countering...' : 'Opponent Thinking')}
              </span>
            </div>
            <div className="flex gap-4 items-center">
               {renderFanStack(me.bank, 'sm')}
               <div className="bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/20 text-amber-400 font-bold text-sm h-fit">{me.properties.filter(p => p.isComplete).length}/3 SETS</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-8 mb-8 flex-1">
            {me.properties.map((set, i) => {
              const isRentValid = isValidRentTarget(set);
              const isForceDealSource = isSelectingMySet && !set.isComplete;
              const isClickable = isRentValid || isForceDealSource;
              
              return (
                <div 
                  key={i} 
                  onClick={() => {
                     if (isRentValid) handleRentCollection(i);
                     if (isForceDealSource) setPendingForceDeal(prev => ({...prev!, mySetIndex: i}));
                  }}
                  className={`relative p-2 rounded-2xl transition-all cursor-pointer
                    ${set.isComplete ? 'scale-[1.02]' : ''}
                    ${pendingRentCard && !isRentValid ? 'opacity-20 grayscale' : ''}
                    ${pendingForceDeal && !isForceDealSource && isSelectingMySet ? 'opacity-20 grayscale' : ''}
                    ${isClickable ? 'ring-4 ring-amber-500 ring-offset-4 ring-offset-[#020617] animate-pulse z-30' : ''}
                    hover:bg-white/5
                  `}
                >
                  {set.isComplete && (
                    <div className="absolute -top-3 -right-3 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)] z-10 border-2 border-slate-900">
                      <i className="fa-solid fa-crown text-white text-xs"></i>
                    </div>
                  )}
                  {isRentValid && (
                    <div className="absolute inset-0 bg-amber-500/10 rounded-2xl flex items-center justify-center z-20">
                      <span className="font-black text-xs text-amber-400 bg-slate-900 px-3 py-1 rounded-full border border-amber-400 uppercase tracking-widest shadow-xl">Collect Here</span>
                    </div>
                  )}
                  {isForceDealSource && (
                    <div className="absolute inset-0 bg-blue-500/10 rounded-2xl flex items-center justify-center z-20">
                      <span className="font-black text-xs text-blue-400 bg-slate-900 px-3 py-1 rounded-full border border-blue-400 uppercase tracking-widest shadow-xl">Swap This</span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-center h-36">
                    {renderFanStack(set.cards, 'md', 'mx-auto')}
                  </div>

                  <div className="absolute bottom-2 right-3 text-[10px] font-black text-white/10 uppercase tracking-widest">{set.color}</div>
                </div>
              );
            })}
          </div>

          <div className={`mt-4 p-4 rounded-3xl border transition-all duration-500 min-h-[200px] flex flex-wrap items-center justify-center gap-3
            ${isMyTurn && gameState.actionsRemaining > 0 ? 'bg-slate-900/60 border-white/5' : 'bg-slate-950/80 border-white/10 blur-[1px]'}
          `}>
             {isMyTurn ? me.hand.map(card => (
               <CardUI 
                 key={card.id} 
                 card={card} 
                 // Added shadow-xl manually since default was removed
                 className="shadow-xl"
                 selected={selectedCardId === card.id} 
                 onClick={() => handleCardClick(card.id)} 
                 disabled={!isMyTurn || isProcessing || gameState.actionsRemaining <= 0 || !!pendingRentCard || !!gameState.pendingAction || !!pendingForceDeal || !!pendingSlyDeal} 
               />
             )) : (
                <div className="flex flex-col items-center gap-4 opacity-40">
                  <div className="flex gap-2 animate-pulse">{[1,2,3].map(i => <div key={i} className="w-10 h-16 bg-slate-800 rounded-lg border border-slate-700" />)}</div>
                  <span className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 animate-pulse">{showJSNPrompt ? 'WAITING FOR INPUT...' : 'WAITING FOR OPPONENT...'}</span>
                </div>
             )}
          </div>
        </div>
      </div>

      {/* JSN Modal */}
      {showJSNPrompt && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="max-w-md w-full bg-slate-900 border-2 border-amber-500 rounded-[3rem] p-12 text-center shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-amber-500 animate-pulse" />
             <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-amber-500">
                <i className="fa-solid fa-hand-paper text-amber-500 text-3xl"></i>
             </div>
             <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter italic">{getJsnPromptText()}</h3>
             <div className="mb-8">
               <p className="text-slate-400 font-bold uppercase text-xs tracking-widest leading-relaxed">
                 {responderName === me.name ? "Do you want to use a 'Just Say No' card?" : `${responderName}, use a 'Just Say No' card?`}
               </p>
               {jsnStack > 0 && <p className="text-amber-500 text-xs font-bold mt-2">JSN CHAIN ACTIVE: {jsnStack}</p>}
             </div>
             <div className="flex flex-col gap-3">
               {me.hand.some(c => c.name === 'Just Say No') && (
                 <button onClick={() => resolvePendingAction(true)} className="w-full py-4 bg-amber-500 text-slate-950 font-black rounded-2xl hover:scale-105 transition active:scale-95 shadow-xl uppercase tracking-widest">USE JUST SAY NO</button>
               )}
               <button onClick={() => resolvePendingAction(false)} className="w-full py-3 text-slate-500 font-black rounded-2xl border border-white/10 hover:bg-white/5 transition uppercase tracking-widest text-xs">LET IT HAPPEN</button>
             </div>
           </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="h-28 bg-slate-900 border-t border-white/5 flex items-center justify-center gap-6 px-10 relative">
        {pendingRentCard ? (
          <div className="animate-in fade-in zoom-in duration-300 flex items-center gap-8">
            <span className="font-black text-amber-500 text-xl italic uppercase tracking-tighter animate-pulse">Choose a Property Set to Collect Rent</span>
            <button onClick={() => { me.hand.push(pendingRentCard); setPendingRentCard(null); }} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-xs">CANCEL ACTION</button>
          </div>
        ) : pendingForceDeal ? (
          <div className="animate-in fade-in zoom-in duration-300 flex items-center gap-8">
            <span className="font-black text-blue-400 text-xl italic uppercase tracking-tighter animate-pulse">
              {pendingForceDeal.mySetIndex === undefined ? 'Select YOUR Property to Swap' : 'Select OPPONENT Property to Swap'}
            </span>
            <button onClick={() => { me.hand.push(pendingForceDeal.card); setPendingForceDeal(null); }} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-xs">CANCEL ACTION</button>
          </div>
        ) : pendingSlyDeal ? (
          <div className="animate-in fade-in zoom-in duration-300 flex items-center gap-8">
            <span className="font-black text-emerald-400 text-xl italic uppercase tracking-tighter animate-pulse">
              Select OPPONENT Property to Steal
            </span>
            <button onClick={() => { me.hand.push(pendingSlyDeal.card); setPendingSlyDeal(null); }} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-xs">CANCEL ACTION</button>
          </div>
        ) : selectedCardId && isMyTurn && gameState.actionsRemaining > 0 ? (
          <div className="flex items-center gap-4 animate-in slide-in-from-bottom-8 duration-500">
            <button onClick={() => executeMove('BANK', selectedCardId)} className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-emerald-800 flex items-center gap-3"><i className="fa-solid fa-piggy-bank"></i> BANK</button>
            <button onClick={() => executeMove('PROPERTY', selectedCardId)} disabled={['MONEY'].includes(me.hand.find(c => c.id === selectedCardId)?.type || '')} className="px-10 py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-amber-800 flex items-center gap-3"><i className="fa-solid fa-city"></i> ASSET</button>
            <button onClick={() => executeMove('ACTION_PLAY', selectedCardId)} disabled={!['ACTION', 'RENT', 'WILD'].includes(me.hand.find(c => c.id === selectedCardId)?.type || '')} className="px-10 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-blue-800 flex items-center gap-3"><i className="fa-solid fa-play"></i> PLAY</button>
            <button onClick={() => setSelectedCardId(null)} className="w-14 h-14 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-2xl transition flex items-center justify-center border border-white/5"><i className="fa-solid fa-times text-xl"></i></button>
          </div>
        ) : (
          <button 
            onClick={endTurn} 
            disabled={!isMyTurn || isProcessing || gameState.phase !== 'PLAY_PHASE' || !!pendingRentCard || !!gameState.pendingAction || !!pendingForceDeal || !!pendingSlyDeal} 
            className={`group relative px-20 py-5 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-10 text-white rounded-2xl font-black tracking-[0.4em] shadow-2xl transition-all active:scale-95 border-b-4 border-red-900 overflow-hidden
              ${isMyTurn && gameState.actionsRemaining <= 0 ? 'animate-pulse scale-105 ring-4 ring-red-500/30' : ''}
            `}
          >
            END TURN
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition rounded-2xl"></div>
          </button>
        )}
      </div>
      
      {/* SHOW LOG OVERLAY */}
      {showLog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-end p-6 pointer-events-none">
           <div className="w-full max-sm:max-w-none max-w-sm bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col p-8 pointer-events-auto animate-in slide-in-from-right-20 duration-500 h-full max-h-[85vh]">
             <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6">
               <span className="font-black text-2xl tracking-tight text-amber-500">HISTORY</span>
               <button onClick={() => setShowLog(false)} className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center transition"><i className="fa-solid fa-times"></i></button>
             </div>
             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2">
                {gameState.logs.map((log, i) => (
                  <div key={i} className="p-4 bg-slate-800/50 rounded-2xl border-l-4 border-amber-500 text-xs font-bold leading-relaxed shadow-sm uppercase tracking-wider">{log}</div>
                ))}
             </div>
           </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 px-10 py-4 bg-amber-500 text-slate-950 rounded-full font-black animate-bounce z-[60] shadow-[0_30px_60px_rgba(245,158,11,0.4)] border-4 border-slate-950 flex items-center gap-4 italic uppercase"><div className="w-3 h-3 bg-slate-950 rounded-full animate-ping" />Gemini is calculating...</div>
      )}

      {gameState.winner && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center z-[100] animate-in fade-in duration-1000">
           <div className="max-w-xl w-full mx-6 bg-slate-900 border-2 border-white/10 p-16 rounded-[4rem] text-center shadow-[0_0_100px_rgba(245,158,11,0.05)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-pulse" />
              <h2 className="text-7xl font-black text-white mb-4 uppercase tracking-tighter italic drop-shadow-2xl">{gameState.winner}</h2>
              <p className="text-amber-500 font-black text-2xl mb-12 tracking-widest uppercase">The Monopoly King</p>
              <button onClick={() => { setGameState(null); setLobbyMode('MAIN'); }} className="w-full py-6 bg-white text-slate-950 font-black rounded-3xl transition transform hover:scale-105 active:scale-95 shadow-2xl tracking-widest">RETURN TO MENU</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;