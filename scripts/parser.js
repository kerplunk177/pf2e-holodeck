window.CombatParser = {
    ledger: { actors: {}, masterLog: [], totalDamage: 0, startTime: null, maxRounds: 1, currentTurnStart: null, currentCombatant: null, currentTurnRound: null },
    explorationLedger: { actors: {}, masterLog: [], totalDamage: 0, startTime: null, maxRounds: 1 },

    getCanonicalName: function(actorDoc, alias) {
        if (!actorDoc) return alias || "Unknown";
        if (actorDoc.type === "character" || actorDoc.type === "familiar" || actorDoc.hasPlayerOwner) {
            return actorDoc.name;
        }
        return alias || actorDoc.name;
    },

    resolveOwner: function(actorName, actorDoc, tokenAlias) {
        if (!actorName) return "Unknown";
        if (actorDoc && actorDoc.flags?.pf2e?.master?.id) {
            let master = game.actors.get(actorDoc.flags.pf2e.master.id);
            if (master) return master.name;
        }
        
        let checkName = actorName;
        if (tokenAlias && tokenAlias.match(/^(.+?)'s /i)) checkName = tokenAlias;

        let match = checkName.match(/^(.+?)'s /i);
        if (match) {
            let possibleName = match[1].toLowerCase();
            let masterActor = game.actors.contents.find(a => 
                (a.type === "character" || a.hasPlayerOwner) && 
                a.id !== actorDoc?.id && 
                a.name.toLowerCase().includes(possibleName)
            );
            if (masterActor) return masterActor.name;
        }

        if (actorDoc) {
            let traits = actorDoc.system?.traits?.value || [];
            let isMinion = traits.includes("minion") || traits.includes("eidolon") || actorDoc.type === "familiar";
            if (isMinion) {
                let ownerUser = game.users.find(u => !u.isGM && actorDoc.testUserPermission(u, "OWNER"));
                if (ownerUser && ownerUser.character && ownerUser.character.id !== actorDoc.id) {
                    return ownerUser.character.name;
                }
            }
        }
        return actorName;
    },

    resetLedger: function() {
        this.ledger = { actors: {}, masterLog: [], totalDamage: 0, startTime: Date.now(), maxRounds: 1, currentTurnStart: null, currentCombatant: null, currentTurnRound: null };
        console.log("PF2e Holodeck | Tactical ledger wiped clean.");
    },

    resetExplorationLedger: function() {
        this.explorationLedger = { actors: {}, masterLog: [], totalDamage: 0, startTime: Date.now(), maxRounds: 1 };
        console.log("PF2e Holodeck | Exploration ledger wiped clean.");
    },

    seedCombatants: function(combat) {
        if (!combat || !combat.combatants) return;
        const activeLedger = this.ledger;
        
        const checkIsAlly = (actDoc) => {
            if (!actDoc) return false;
            if (actDoc.type === "character" || actDoc.type === "familiar") return true;
            if (actDoc.alliance === "party") return true;
            try { if (game.users.some(u => !u.isGM && actDoc.testUserPermission(u, "OWNER"))) return true; } catch(e){}
            return false;
        };

        combat.combatants.forEach(c => {
            let actorDoc = c.actor;
            if (!actorDoc) return;
            
            let rawName = window.CombatParser.getCanonicalName(actorDoc, c.name);
            let actorName = window.CombatParser.resolveOwner(rawName, actorDoc, c.name);
            let actorType = actorDoc.type;
            let actorLevel = parseInt(actorDoc.system?.details?.level?.value) || 0;
            let allyStatus = checkIsAlly(actorDoc);

            if (!activeLedger.actors[actorName]) {
                activeLedger.actors[actorName] = {
                    name: actorName, type: actorType, level: actorLevel, isAlly: allyStatus,
                    damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                    nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, 
                    expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                };
            } else {
                if (allyStatus) activeLedger.actors[actorName].isAlly = true;
            }
        });
    },

    saveArchive: async function() {
        if (!game.user.isGM || Object.keys(this.ledger.actors).length === 0) return;
        const isHolodeck = canvas.scene?.getFlag('pf2e-holodeck', 'active');
        const targetDbName = isHolodeck ? 'holodeckHistory' : 'combatHistory';
        const history = game.settings.get('pf2e-holodeck', targetDbName) || {};
        const now = new Date();
        const encounterName = `${isHolodeck ? "[SIM] " : ""}${canvas.scene?.name || "Unknown Zone"} (${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
        
        history[encounterName] = foundry.utils.deepClone(this.ledger);
        await game.settings.set('pf2e-holodeck', targetDbName, history);
        if (game.user.isGM) await game.settings.set('pf2e-holodeck', 'activeTactical', {});
        this.resetLedger();
    },

    saveExplorationArchive: async function() {
        if (!game.user.isGM || Object.keys(this.explorationLedger.actors).length === 0) return;
        const history = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
        const now = new Date();
        const encounterName = `[EXPLORE] ${canvas.scene?.name || "Unknown Zone"} (${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
        
        history[encounterName] = foundry.utils.deepClone(this.explorationLedger);
        await game.settings.set('pf2e-holodeck', 'explorationHistory', history);
        this.resetExplorationLedger();
    },

    saveLiveBackup: async function() {
        if (!game.user.isGM) return;
        await game.settings.set('pf2e-holodeck', 'activeTactical', this.ledger);
    },

    restoreLiveBackup: function() {
        let saved = game.settings.get('pf2e-holodeck', 'activeTactical');
        if (saved && saved.actors && Object.keys(saved.actors).length > 0 && game.combat && game.combat.active) {
            this.ledger = saved;
            console.log("Combat Forensics | Restored mid-session combat from backup.");
        }
    },

    parseMessage: function(message) {
        try {
            const systemFlags = message.flags?.pf2e || message.flags?.sf2e || {};
            const context = systemFlags.context || {};
            const fullText = `${message.flavor || ""} ${message.content || ""}`.replace(/<[^>]*>?/gm, ' ').trim();

            const isCombatPhase = (canvas.scene && canvas.scene.getFlag('pf2e-holodeck', 'active')) || (game.combat && game.combat.active);
            const activeLedger = isCombatPhase ? this.ledger : this.explorationLedger;

            const hasAppliedDamage = !!systemFlags.appliedDamage;
            const isNarrativeDamage = /(?:unscathed|absorbing|takes \d+ damage|healed \d+|restored \d+|\d+ healing|reduced by|mitigated)/i.test(fullText);
            const isApplication = !message.isDamageRoll && context.type !== "damage-roll" && (context.type === "damage-taken" || hasAppliedDamage || isNarrativeDamage);
            const isDamageRoll = message.isDamageRoll || context.type === "damage-roll";
            
            const checkIsAlly = (actDoc) => {
                if (!actDoc) return false;
                if (actDoc.type === "character" || actDoc.type === "familiar") return true;
                if (actDoc.alliance === "party") return true;
                try { if (game.users.some(u => !u.isGM && actDoc.testUserPermission(u, "OWNER"))) return true; } catch(e){}
                return false;
            };

            let msgActor = message.actor || (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
            let alias = message.speaker?.alias || message.alias;
            let rawActorName = window.CombatParser.getCanonicalName(msgActor, alias);
            let resolvedOwner = window.CombatParser.resolveOwner(rawActorName, msgActor, alias);
            
            let minionName = null;
            let checkNameForTag = (rawActorName !== resolvedOwner) ? rawActorName : (alias !== resolvedOwner ? alias : null);
            
            if (checkNameForTag) {
                let match = checkNameForTag.match(/^.+?'s (.+)/i);
                if (match) {
                    minionName = match[1].trim();
                } else {
                    minionName = checkNameForTag.trim();
                }
            } else if (msgActor && msgActor.name !== resolvedOwner) {
                minionName = msgActor.name.trim();
            }
            if (minionName === "Unknown" || minionName === "") minionName = null;

            let actionName = "Unknown Action";
            if (message.flavor) {
                let cleanFlavor = message.flavor.replace(/<\/h4>/gi, ' - ').replace(/<\/span>/gi, ' | ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\|\s*\|/g, '|').replace(/\s*\|\s*$/g, '').trim();
                if (cleanFlavor) actionName = cleanFlavor;
            } else {
                actionName = message.item ? message.item.name : "Unknown Action";
            }

            const getActorLevel = (actorDoc) => {
                if (!actorDoc) return 0;
                return parseInt(actorDoc.system?.details?.level?.value) || 0;
            };

            if (isApplication || (context.type === "damage-roll" && message.flags["aoe-easy-resolve"])) {
                const applied = systemFlags.appliedDamage;
                
                // --- AOE EASY RESOLVE INTERCEPTOR ---
                let aoeHealValue = 0;
                if (message.flags["aoe-easy-resolve"]?.damageTotal !== undefined) {
                     const isAoEHealing = /(?:healed|restored|Healing)/i.test(message.flags["aoe-easy-resolve"].damageTooltip || fullText);
                     if (isAoEHealing) aoeHealValue = parseInt(message.flags["aoe-easy-resolve"].damageTotal);
                }
                
                const isHealing = applied ? applied.isHealing === true : (aoeHealValue > 0 || /(?:healed|restored|healing)/i.test(fullText));
                // ------------------------------------

                let attackerName = "Unknown Source";
                let attackerType = "npc";
                let attackerLevel = 0;
                let targetName = "None";
                let targetLevel = 0;
                let attackerDoc = null;
                let targetDoc = null;
                let inheritedMinion = minionName;

                if (context.target?.token && canvas.scene) {
                    const t = canvas.scene.tokens.get(context.target.token);
                    if (t) { targetName = t.name; targetDoc = t.actor; }
                } else if (systemFlags.appliedDamage?.uuid) {
                    targetDoc = fromUuidSync(systemFlags.appliedDamage.uuid);
                    if (targetDoc) targetName = targetDoc.parent?.name || targetDoc.name;
                } else if (message.speaker?.alias) {
                    targetName = message.speaker.alias;
                    targetDoc = message.actor;
                } else if (message.actor) {
                    targetName = message.actor.name;
                    targetDoc = message.actor;
                }
                if (targetDoc) {
                    let tRawName = window.CombatParser.getCanonicalName(targetDoc, targetName);
                    targetName = window.CombatParser.resolveOwner(tRawName, targetDoc, targetName);
                    targetLevel = getActorLevel(targetDoc);
                }

                let turnBoundaryCrossed = false;

                for (let i = activeLedger.masterLog.length - 1; i >= 0; i--) {
                    let prev = activeLedger.masterLog[i];
                    if (prev.isTurnSummary) turnBoundaryCrossed = true;

                    if (prev.type === "Roll" || prev.type === "Attack" || prev.type === "Save" || prev.type === "Skill") {
                        let liveAct = game.actors.find(a => a.name === prev.source);
                        let isTargetAlly = targetDoc ? checkIsAlly(targetDoc) : false;
                        let isPrevSourceAlly = liveAct ? checkIsAlly(liveAct) : false;

                        let isCrossAllianceHealing = isHealing && (isTargetAlly !== isPrevSourceAlly);
                        let isDifferentTarget = prev.target !== "Unknown / AoE" && prev.target !== "None" && targetName !== "None" && prev.target !== targetName;
                        let isPrevPersistent = prev.name && prev.name.toLowerCase().includes("persistent damage");

                        let forceIntercept = false;
                        let interceptName = "Persistent Condition";

                        if (isHealing && (isCrossAllianceHealing || isPrevPersistent)) {
                            forceIntercept = true;
                            interceptName = "Fast Healing / Regen";
                        } else if (isDifferentTarget || (turnBoundaryCrossed && isPrevPersistent)) {
                            forceIntercept = true;
                            interceptName = "Persistent Condition";
                        }

                        if (forceIntercept) {
                            attackerName = targetName !== "None" ? targetName : "Environment";
                            actionName = interceptName;
                            attackerType = targetDoc ? targetDoc.type : "npc";
                            attackerLevel = targetLevel;
                            attackerDoc = targetDoc;
                        } else {
                            attackerName = prev.source;
                            if (prev.name && prev.name !== "Unknown Action") actionName = prev.name; 
                            if (prev.minion) inheritedMinion = prev.minion;
                            if (prev.target !== "Unknown / AoE" && prev.target !== "None") targetName = prev.target;
                            if (liveAct) {
                                attackerType = liveAct.type;
                                attackerLevel = getActorLevel(liveAct);
                                attackerDoc = liveAct;
                            }
                        }
                        break;
                    }
                }

                if (attackerName === "Unknown Source" && systemFlags.origin?.actor) {
                    const tempAttackerDoc = fromUuidSync(systemFlags.origin.actor);
                    if (tempAttackerDoc) {
                        const actualActor = tempAttackerDoc.actor || tempAttackerDoc; 
                        let tAlias = actualActor.name;
                        let rawName = window.CombatParser.getCanonicalName(actualActor, tAlias);
                        attackerName = window.CombatParser.resolveOwner(rawName, actualActor, tAlias);
                        attackerType = actualActor.type;
                        attackerLevel = getActorLevel(actualActor);
                        attackerDoc = actualActor;
                    }
                }

                let valueTotal = 0;
                if (aoeHealValue > 0) {
                     valueTotal = aoeHealValue;
                } else {
                    const textMatch = fullText.match(/(?:damaged for|healed|takes|restored|healing).*?(\d+)/i) || fullText.match(/(\d+)\s*(?:HP|Damage|DMG|Heal|Healing)/i);
                    if (textMatch) valueTotal = parseInt(textMatch[1]);
                    else {
                        const allNums = fullText.match(/(\d+)/g);
                        if (allNums && allNums.length > 0) valueTotal = parseInt(allNums[allNums.length - 1]);
                    }
                }

                if (/(?:unscathed|completely absorbing)/i.test(fullText)) valueTotal = 0;

                if (!activeLedger.actors[attackerName]) {
                    activeLedger.actors[attackerName] = {
                        name: attackerName, type: attackerType, level: attackerLevel, isAlly: checkIsAlly(attackerDoc),
                        damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                        nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                    };
                }

                let stats = activeLedger.actors[attackerName];
                let currentRound = game.combat ? game.combat.round : 1;
                if (currentRound > activeLedger.maxRounds) activeLedger.maxRounds = currentRound;

                let mitigatedTotal = 0;
                const mitRegex = /(?:reduced by|resist|absorb|shield block|mitigat)[^\d]*(\d+)/ig;
                let mitMatch;
                while ((mitMatch = mitRegex.exec(fullText)) !== null) mitigatedTotal += parseInt(mitMatch[1]);

                if (mitigatedTotal > 0 && !isHealing && targetName !== "None") {
                    if (!activeLedger.actors[targetName]) {
                        activeLedger.actors[targetName] = {
                            name: targetName, type: "npc", level: targetLevel, isAlly: checkIsAlly(targetDoc),
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                        };
                    }
                    activeLedger.actors[targetName].mitigated += mitigatedTotal;
                }

                if (valueTotal === 0 && mitigatedTotal === 0) return; 

                let isKill = false;
                if (applied && applied.updates) {
                    applied.updates.forEach(u => { if (u.path && u.path.includes("hp.value") && parseInt(u.value) <= 0) isKill = true; });
                }
                if (/(?:unconscious|dying|dead|destroyed|kill)/i.test(fullText)) isKill = true;

                if (isHealing) {
                    stats.healingDealt += valueTotal;
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: attackerName, target: targetName, type: "Heal", name: actionName, result: `${valueTotal} HEALED`, detail: `Actual HP restored via healing.`, damageVal: 0, healVal: valueTotal, minion: inheritedMinion };
                    stats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                } else {
                    stats.damageDealt += valueTotal;
                    if (isKill) stats.kills++;
                    activeLedger.totalDamage += valueTotal;
                    
                    let resultText = valueTotal === 0 ? `FULLY MITIGATED` : `${valueTotal} DMG APPLIED`;
                    if (isKill) resultText += " 💀";
                    if (mitigatedTotal > 0) resultText += ` <span style="color:#aaa;">(${mitigatedTotal} BLKD)</span>`;
                    
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: attackerName, target: targetName, type: valueTotal === 0 ? "Mitigation" : "Damage", name: actionName, result: resultText, detail: `Actual HP removed after saves, weaknesses, and resistances.`, damageVal: valueTotal, healVal: 0, minion: inheritedMinion };
                    stats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                }
                
                if (isCombatPhase) this.saveLiveBackup();
                return; 
            }

            if (isDamageRoll && message.rolls) {
                const rollTotal = message.rolls.reduce((sum, roll) => sum + roll.total, 0);
                let damageDetails = [];
                let expectedTotal = 0;
                const actorName = resolvedOwner;
                
                if (!activeLedger.actors[actorName]) {
                    activeLedger.actors[actorName] = {
                        name: actorName, type: msgActor ? msgActor.type : "npc", level: getActorLevel(msgActor), isAlly: checkIsAlly(msgActor),
                        damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                        nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                    };
                }
                
                let stats = activeLedger.actors[actorName];
                let currentRound = game.combat ? game.combat.round : 1;

                try {
                    const extractPF2eDice = (obj) => {
                        let actual = 0; let expected = 0; let seen = new Set();
                        const search = (o) => {
                            if (!o || typeof o !== 'object') return;
                            if (seen.has(o)) return;
                            seen.add(o);
                            if (o.faces !== undefined && o.number !== undefined && Array.isArray(o.results)) {
                                let activeResults = o.results.filter(res => res.active !== false && !res.discarded);
                                expected += ((o.faces + 1) / 2) * activeResults.length;
                                activeResults.forEach(res => actual += (res.result || 0));
                                return; 
                            }
                            for (let key in o) { if (o.hasOwnProperty(key)) search(o[key]); }
                        };
                        search(obj);
                        return { actual, expected };
                    };

                    message.rolls.forEach(r => {
                        let diceStats = extractPF2eDice(r);
                        expectedTotal += (r.total - diceStats.actual + diceStats.expected);
                        if (r.instances) {
                            r.instances.forEach(i => {
                                let dmgType = i.type || "untyped";
                                if (!stats.damageTypes) stats.damageTypes = {};
                                if (!stats.damageTypes[dmgType]) stats.damageTypes[dmgType] = { instances: 0, total: 0 };
                                stats.damageTypes[dmgType].instances += 1;
                                stats.damageTypes[dmgType].total += i.total;
                                damageDetails.push(`${i.total} ${dmgType}`);
                            });
                        }
                    });
                } catch (e) {
                    expectedTotal += rollTotal;
                }

                stats.expectedDamage = (stats.expectedDamage || 0) + expectedTotal;
                stats.actualDamageRoll = (stats.actualDamageRoll || 0) + rollTotal;
                let detailStr = damageDetails.length > 0 ? damageDetails.join(', ') : `Rolled ${message.rolls.length} dice`;
                let merged = false;
                
                if (stats) {
                    for (let i = stats.history.length - 1; i >= 0; i--) {
                        let prev = stats.history[i];
                        if (prev.type === "Attack" && prev.round === currentRound && !prev.hasDamageRoll) {
                            prev.result += ` 🎲 [${rollTotal}]`;
                            prev.detail += `<br><span style="color:#aaa;"><b>Dice Pool:</b> ${detailStr}</span>`;
                            prev.hasDamageRoll = true;
                            merged = true;
                            break;
                        }
                    }
                }

                if (!merged) {
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: actorName, target: "None", type: "Roll", name: actionName, result: `Dice Pool: ${rollTotal}`, detail: detailStr, damageVal: 0, healVal: 0, minion: minionName };
                    if (stats) stats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                }
                
                if (isCombatPhase) this.saveLiveBackup();
                return;
            }

            if (isAttack || isSave || isSkill) {
                const actor = message.actor;
                const itemUuid = systemFlags?.item?.uuid || context.item;
                if (!actor || (!context.type && !itemUuid)) return;

                const actorName = resolvedOwner;
                const actorLevel = getActorLevel(actor);

                if (!activeLedger.actors[actorName]) {
                    activeLedger.actors[actorName] = {
                        name: actorName, type: actor.type, level: actorLevel, isAlly: checkIsAlly(actor),
                        damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                        nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                    };
                }

                let stats = activeLedger.actors[actorName];
                let currentRound = game.combat ? game.combat.round : 1;
                if (currentRound > activeLedger.maxRounds) activeLedger.maxRounds = currentRound;

                let targetName = "None";
                if (context.target?.token && canvas.scene) {
                    const t = canvas.scene.tokens.get(context.target.token);
                    if (t) targetName = t.name;
                } else if (game.user.targets.size > 0) {
                    targetName = Array.from(game.user.targets)[0].name;
                }

                const outcome = context.outcome; 
                const isCrit = outcome === 'criticalSuccess' || outcome === 'critical-success';
                
                if (outcome === 'success') stats.hits++;
                if (isCrit) stats.crits++;
                if (outcome === 'failure') stats.misses++;
                if (outcome === 'criticalFailure' || outcome === 'critical-failure') stats.critMisses++;

                const isHeroPoint = context.isReroll || (context.options && context.options.includes("hero-point")) || /(?:hero point|reroll)/i.test(fullText);
                if (isHeroPoint) {
                    stats.heroPoints++;
                    if (isCrit) stats.heroPointCrits++;
                }

                let d20Val = 0; let totalVal = 0; let modVal = 0;
                if (message.rolls && message.rolls.length > 0) {
                    const firstRoll = message.rolls[0];
                    totalVal = firstRoll.total;
                    const d20Term = firstRoll.terms.find(t => t.faces === 20);
                    if (d20Term && d20Term.results.length > 0) {
                        d20Val = d20Term.results[0].result;
                        modVal = totalVal - d20Val; 
                        if (d20Val === 1) stats.nat1s++;
                        if (d20Val === 20) stats.nat20s++;
                        if (d20Val >= 1 && d20Val <= 20) {
                            if (!stats.d20Rolls) stats.d20Rolls = Array(20).fill(0);
                            stats.d20Rolls[d20Val - 1]++;
                        }
                    }
                }

                let rollType = "Roll";
                if (isAttack) rollType = "Attack";
                if (isSave) rollType = "Save";
                if (isSkill) rollType = "Skill";

                let resultText = "UNKNOWN";
                if (outcome) resultText = outcome.toUpperCase();
                else if (totalVal > 0) resultText = `ROLLED ${totalVal}`;

                let extraDetails = [];
                let robustTags = [];
                
                if (context.traits && Array.isArray(context.traits)) {
                    context.traits.forEach(t => {
                        let tName = typeof t === 'string' ? t : t.name;
                        if (tName) robustTags.push(tName);
                    });
                }
                
                if (context.dc && context.dc.value) {
                    extraDetails.push(`<span style="color:#ffcc00; font-weight:bold;">Target DC: ${context.dc.value}</span>`);
                }
                
                if (systemFlags.modifiers && systemFlags.modifiers.length > 0) {
                    let activeMods = systemFlags.modifiers.filter(m => m.enabled || m.ignored === false).map(m => `${m.label} ${m.modifier < 0 ? '' : '+'}${m.modifier}`);
                    if (activeMods.length > 0) extraDetails.push(`<span style="color:#aaa;"><b>Mods:</b> ${activeMods.join(', ')}</span>`);
                }

                let detailHtml = `<b>Total:</b> ${totalVal} (d20: ${d20Val} + ${modVal})`;
                if (extraDetails.length > 0) {
                    detailHtml += `<br><div style="margin-top:6px; padding-top:6px; border-top:1px dashed #444; font-size:0.85em; line-height:1.4;">${extraDetails.join('<br>')}</div>`;
                }

                const logEntry = {
                    id: foundry.utils.randomID(), round: currentRound, source: actorName, target: targetName,
                    type: rollType, name: actionName, result: resultText,
                    detail: detailHtml, damageVal: 0, healVal: 0, tags: robustTags, minion: minionName
                };
                stats.history.push(logEntry);
                activeLedger.masterLog.push(logEntry);
                
                if (isCombatPhase) this.saveLiveBackup();
            }
        } catch (e) {}
    }
};

class CombatForensicsApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "combat-forensics-ui", classes: ["holodeck-window"], position: { width: 800, height: 750 }, 
        window: { title: "Combat Forensics", resizable: true },
        actions: {
            setViewMode: function(event, target) {
                this.viewMode = target.dataset.mode;
                this.render({parts: ["main"]});
            },
            clearHistory: async function() {
                if (game.user.isGM) {
                    await game.settings.set('pf2e-holodeck', 'combatHistory', {});
                    await game.settings.set('pf2e-holodeck', 'holodeckHistory', {});
                    await game.settings.set('pf2e-holodeck', 'explorationHistory', {});
                    this.selectedEncounter = "exploration";
                    this.expandedLogs = {};
                    this.expandedActors = {};
                    this.render({parts: ["main"]});
                    ui.notifications.warn("Combat Forensics | All databases purged.");
                }
            },
            swapAllegiance: async function(event, target) {
                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;
                
                const actorName = target.dataset.actor;
                let targetLedger = this.selectedEncounter === "current" ? window.CombatParser.ledger :
                                   this.selectedEncounter === "exploration" ? window.CombatParser.explorationLedger : null;
                let dbName = null;
                let encName = this.selectedEncounter;

                if (!targetLedger) {
                    const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                    const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                    const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                    if (hDb[encName]) { targetLedger = hDb[encName]; dbName = 'combatHistory'; }
                    else if (eDb[encName]) { targetLedger = eDb[encName]; dbName = 'explorationHistory'; }
                    else if (sDb[encName]) { targetLedger = sDb[encName]; dbName = 'holodeckHistory'; }
                }

                if (targetLedger && targetLedger.actors[actorName]) {
                    targetLedger.actors[actorName].isAlly = !targetLedger.actors[actorName].isAlly;
                    if (dbName) {
                        let db = game.settings.get('pf2e-holodeck', dbName);
                        db[encName] = targetLedger;
                        await game.settings.set('pf2e-holodeck', dbName, db);
                    }
                    this.expandedActors[actorName] = true;
                    this.render({parts: ["main"]});
                    ui.notifications.info(`Combat Forensics | ${actorName} allegiance swapped.`);
                }
            },
            reassignLog: async function(event, target) {
                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;
                
                const logId = target.dataset.logId;
                
                let targetLedger = this.selectedEncounter === "current" ? window.CombatParser.ledger :
                                   this.selectedEncounter === "exploration" ? window.CombatParser.explorationLedger : null;
                let dbName = null;
                let encName = this.selectedEncounter;

                if (!targetLedger) {
                    const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                    const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                    const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                    if (hDb[encName]) { targetLedger = hDb[encName]; dbName = 'combatHistory'; }
                    else if (eDb[encName]) { targetLedger = eDb[encName]; dbName = 'explorationHistory'; }
                    else if (sDb[encName]) { targetLedger = sDb[encName]; dbName = 'holodeckHistory'; }
                }

                if (!targetLedger) return;

                const logEntry = targetLedger.masterLog.find(l => l.id === logId);
                if (!logEntry) return ui.notifications.warn("Combat Forensics | Log ID not found. Ensure databases are migrated.");

                let actorAbilities = {};
                Object.entries(targetLedger.actors).forEach(([aName, aData]) => {
                    let abilities = new Set();
                    aData.history.forEach(h => {
                        if (h.name && h.name !== "Unknown Action" && h.name !== "Persistent Condition" && h.name !== "Fast Healing / Regen") {
                            abilities.add(h.name);
                        }
                    });
                    actorAbilities[aName] = Array.from(abilities).sort();
                });

                let actorOptions = Object.keys(targetLedger.actors).map(name => `<option value="${name}" ${name === logEntry.source ? 'selected' : ''}>${name}</option>`).join("");

                let otherLogsBySource = targetLedger.masterLog.filter(l => !l.isDivider && !l.isTurnSummary && l.source === logEntry.source && l.id !== logId && l.name === logEntry.name);
                let checklistHtml = "";
                
                if (otherLogsBySource.length > 0) {
                    checklistHtml = `
                        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #555;">
                            <label style="display: flex; align-items: center; gap: 8px; font-weight: bold; color: #ff4444; cursor: pointer; margin-bottom: 8px; font-size: 1.1em;">
                                <input type="checkbox" id="mass-audit-master" style="width: 16px; height: 16px;" onchange="document.querySelectorAll('.mass-audit-cb').forEach(cb => cb.checked = this.checked)"> 
                                Attribute More (Select additional logs to move)
                            </label>
                            <div style="max-height: 200px; overflow-y: auto; background: #050508; border: 1px solid #333; padding: 10px; border-radius: 3px; box-shadow: inset 0 0 5px #000;">
                                ${otherLogsBySource.map(l => `
                                    <label style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.9em; margin-bottom: 8px; color: #ccc; cursor: pointer; padding-bottom: 6px; border-bottom: 1px solid #222;">
                                        <input type="checkbox" class="mass-audit-cb" value="${l.id}" style="margin-top: 3px; width: 14px; height: 14px;">
                                        <div style="flex: 1;">
                                            <span style="color: #888; font-weight:bold;">R${l.round}</span> | 
                                            <span style="color: #ffaa00;">${l.target !== "None" ? l.target : "AoE"}</span> | 
                                            ${l.name} <br>
                                            <span style="color: ${l.type === 'Damage' ? '#ff6666' : (l.type === 'Heal' ? '#44ff44' : '#888')}; font-size: 0.9em;">
                                                ${l.type === 'Damage' ? (l.damageVal + ' DMG') : (l.type === 'Heal' ? (l.healVal + ' HEAL') : l.result)}
                                            </span>
                                        </div>
                                    </label>
                                `).join("")}
                            </div>
                        </div>
                    `;
                }

                const content = `
                    <div style="background: #0f0f15; color: #eee; padding: 15px; border: 1px solid #444; border-radius: 4px; font-family: 'Signika', sans-serif;">
                        <form>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Attributing Actor:</label>
                                <select id="new-actor-source" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                    ${actorOptions}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Ability / Spell Source:</label>
                                <select id="new-action-select" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                </select>
                            </div>
                            <div class="form-group" id="new-action-custom-container" style="margin-bottom: 10px; display: none;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Custom Action Name:</label>
                                <input type="text" id="new-action-custom" value="${logEntry.name || 'Unknown Action'}" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                            </div>
                            ${checklistHtml}
                        </form>
                    </div>
                `;

                new Dialog({
                    title: "Audit Combat Record",
                    content: content,
                    render: (html) => {
                        const sourceSelect = html.find('#new-actor-source')[0];
                        const actionSelect = html.find('#new-action-select')[0];
                        const customContainer = html.find('#new-action-custom-container')[0];
                        const customInput = html.find('#new-action-custom')[0];

                        const updateActionDropdown = () => {
                            const selectedActor = sourceSelect.value;
                            const abilities = actorAbilities[selectedActor] || [];
                            let options = abilities.map(a => `<option value="${a}" ${a === logEntry.name ? 'selected' : ''}>${a}</option>`).join("");
                            options += `<option value="Other" ${!abilities.includes(logEntry.name) ? 'selected' : ''}>Other (Custom)...</option>`;
                            
                            actionSelect.innerHTML = options;
                            
                            if (actionSelect.value === "Other") {
                                customContainer.style.display = "block";
                                customInput.value = logEntry.name;
                            } else {
                                customContainer.style.display = "none";
                                customInput.value = actionSelect.value;
                            }
                        };

                        sourceSelect.addEventListener('change', updateActionDropdown);
                        actionSelect.addEventListener('change', () => {
                            if (actionSelect.value === "Other") {
                                customContainer.style.display = "block";
                                customInput.value = "";
                            } else {
                                customContainer.style.display = "none";
                                customInput.value = actionSelect.value;
                            }
                        });
                        updateActionDropdown();
                    },
                    buttons: {
                        save: {
                            icon: '<i class="fas fa-save"></i>',
                            label: "Update Ledger",
                            callback: async (html) => {
                                const newSource = html.find('#new-actor-source').val();
                                const actionSelection = html.find('#new-action-select').val();
                                const customName = html.find('#new-action-custom').val();
                                const newName = actionSelection === "Other" ? customName : actionSelection;
                                
                                let selectedIds = [logId];
                                html.find('.mass-audit-cb:checked').each(function() { selectedIds.push(this.value); });

                                const transferLogStats = (oldStats, newStats, lEntry) => {
                                    if (!oldStats || !newStats) return;

                                    if (lEntry.type === "Damage" || lEntry.type === "Mitigation") {
                                        oldStats.damageDealt -= (lEntry.damageVal || 0);
                                        newStats.damageDealt += (lEntry.damageVal || 0);
                                        if (lEntry.result && lEntry.result.includes("💀")) {
                                            oldStats.kills = Math.max(0, oldStats.kills - 1); 
                                            newStats.kills++;
                                        }
                                    } 
                                    else if (lEntry.type === "Heal") {
                                        oldStats.healingDealt -= (lEntry.healVal || 0);
                                        newStats.healingDealt += (lEntry.healVal || 0);
                                    } 
                                    else if (lEntry.type === "Roll") {
                                        let poolMatch = lEntry.result ? lEntry.result.match(/Dice Pool:\s*(\d+)/) : null;
                                        if (poolMatch) {
                                            let rollTotal = parseInt(poolMatch[1]);
                                            oldStats.actualDamageRoll -= rollTotal;
                                            newStats.actualDamageRoll += rollTotal;
                                        }
                                        if (lEntry.detail) {
                                            let typeMatches = [...lEntry.detail.matchAll(/(\d+)\s+([a-zA-Z]+)/g)];
                                            typeMatches.forEach(m => {
                                                let val = parseInt(m[1]);
                                                let dType = m[2].toLowerCase();
                                                
                                                if (oldStats.damageTypes && oldStats.damageTypes[dType]) {
                                                    oldStats.damageTypes[dType].total -= val;
                                                    oldStats.damageTypes[dType].instances -= 1;
                                                }
                                                if (!newStats.damageTypes) newStats.damageTypes = {};
                                                if (!newStats.damageTypes[dType]) newStats.damageTypes[dType] = { instances: 0, total: 0 };
                                                newStats.damageTypes[dType].total += val;
                                                newStats.damageTypes[dType].instances += 1;
                                            });
                                        }
                                    } 
                                    else if (lEntry.type === "Attack" || lEntry.type === "Save" || lEntry.type === "Skill") {
                                        let res = lEntry.result || "";
                                        if (res.includes("CRITICALSUCCESS") || res.includes("CRITICAL SUCCESS")) { oldStats.crits = Math.max(0, oldStats.crits - 1); newStats.crits++; }
                                        else if (res.includes("SUCCESS")) { oldStats.hits = Math.max(0, oldStats.hits - 1); newStats.hits++; }
                                        else if (res.includes("CRITICALFAILURE") || res.includes("CRITICAL FAILURE")) { oldStats.critMisses = Math.max(0, oldStats.critMisses - 1); newStats.critMisses++; }
                                        else if (res.includes("FAILURE")) { oldStats.misses = Math.max(0, oldStats.misses - 1); newStats.misses++; }

                                        let d20Match = lEntry.detail ? lEntry.detail.match(/d20:\s*(\d+)/) : null;
                                        if (d20Match) {
                                            let d20Val = parseInt(d20Match[1]);
                                            if (d20Val === 20) { oldStats.nat20s = Math.max(0, oldStats.nat20s - 1); newStats.nat20s++; }
                                            if (d20Val === 1) { oldStats.nat1s = Math.max(0, oldStats.nat1s - 1); newStats.nat1s++; }
                                            if (d20Val >= 1 && d20Val <= 20) {
                                                if (oldStats.d20Rolls && oldStats.d20Rolls[d20Val - 1] > 0) oldStats.d20Rolls[d20Val - 1]--;
                                                if (!newStats.d20Rolls) newStats.d20Rolls = Array(20).fill(0);
                                                newStats.d20Rolls[d20Val - 1]++;
                                            }
                                        }
                                    }

                                    oldStats.history = oldStats.history.filter(h => h.id !== lEntry.id);
                                    let clonedHistoryEntry = foundry.utils.deepClone(lEntry);
                                    clonedHistoryEntry.source = newSource;
                                    clonedHistoryEntry.name = newName;
                                    clonedHistoryEntry.minion = null;
                                    newStats.history.push(clonedHistoryEntry);
                                };

                                selectedIds.forEach(targetId => {
                                    let lEntry = targetLedger.masterLog.find(l => l.id === targetId);
                                    if (!lEntry) return;

                                    let oldSource = lEntry.source;
                                    this.expandedActors[oldSource] = true;

                                    if (oldSource !== newSource) {
                                        transferLogStats(targetLedger.actors[oldSource], targetLedger.actors[newSource], lEntry);
                                    } else {
                                        let stats = targetLedger.actors[oldSource];
                                        if (stats) {
                                            let hist = stats.history.find(h => h.id === targetId);
                                            if (hist) {
                                                hist.name = newName;
                                                hist.minion = null;
                                            }
                                        }
                                    }
                                    lEntry.source = newSource;
                                    lEntry.name = newName;
                                    lEntry.minion = null;
                                });

                                this.expandedActors[newSource] = true;

                                if (dbName) {
                                    let db = game.settings.get('pf2e-holodeck', dbName);
                                    db[encName] = targetLedger;
                                    await game.settings.set('pf2e-holodeck', dbName, db);
                                }

                                this.render({parts: ["main"]});
                            }
                        },
                        cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
                    },
                    default: "save"
                }, { width: 500, classes: ["dialog", "combat-forensics-dialog"] }).render(true);
            },
            exportData: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can archive to journals.");
                const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                
                if (Object.keys(hDb).length === 0 && Object.keys(sDb).length === 0 && Object.keys(eDb).length === 0) return ui.notifications.warn("No data to archive.");

                const buildHtml = (db, title) => {
                    let htmlContent = `<h1 style="border-bottom: 2px solid #44aaff;">${title}</h1>`;
                    for (const [encounterName, data] of Object.entries(db)) {
                        htmlContent += `<h2>${encounterName}</h2><p><b>Total Damage:</b> ${data.totalDamage}</p>
                        <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 0.9em; text-align: left;">
                        <thead style="background: rgba(0,0,0,0.1);"><tr><th>Combatant</th><th>DMG Dealt</th><th>Kills</th><th>Mitigated</th><th>Rolls</th></tr></thead><tbody>`;
                        
                        const actors = Object.values(data.actors || {}).sort((a,b) => b.damageDealt - a.damageDealt);
                        for (const a of actors) {
                            const totalAttacks = (a.hits||0) + (a.misses||0) + (a.crits||0) + (a.critMisses||0);
                            const rawRolls = a.d20Rolls || Array(20).fill(0);
                            const totalD20s = rawRolls.reduce((sum, count) => sum + count, 0);
                            const displayedRolls = Math.max(totalAttacks, totalD20s);
                            
                            htmlContent += `<tr><td><b>${a.name}</b></td><td style="color: #aa4444;">${a.damageDealt || 0}</td>
                            <td>${a.kills || 0}</td><td style="color: #aaaaaa;">${a.mitigated || 0}</td><td>${displayedRolls}</td></tr>`;
                        }
                        htmlContent += `</tbody></table><hr>`;
                    }
                    return htmlContent;
                };

                const pages = [];
                if (Object.keys(hDb).length > 0) pages.push({ name: "Campaign Metrics", type: "text", text: { format: 1, content: buildHtml(hDb, "Campaign Combat Metrics") }});
                if (Object.keys(eDb).length > 0) pages.push({ name: "Exploration Logs", type: "text", text: { format: 1, content: buildHtml(eDb, "Out-of-Combat Exploration Logs") }});
                if (Object.keys(sDb).length > 0) pages.push({ name: "Classified Simulations", type: "text", text: { format: 1, content: buildHtml(sDb, "Holodeck Test Logs") }});

                const journal = await JournalEntry.create({ 
                    name: `Data Archives (${new Date().toLocaleDateString()})`, 
                    pages: pages,
                    flags: {
                        "pf2e-holodeck": {
                            archiveData: { combatHistory: hDb, explorationHistory: eDb, holodeckHistory: sDb }
                        }
                    }
                });
                
                if (journal) { journal.sheet.render(true); ui.notifications.info("Combat Forensics | Data archived to Journal successfully."); }
            },
            downloadJSON: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can download raw JSON databases.");
                const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                
                if (Object.keys(hDb).length === 0 && Object.keys(sDb).length === 0 && Object.keys(eDb).length === 0) return ui.notifications.warn("No data to export.");

                const exportPayload = {
                    exportDate: new Date().toISOString(),
                    module: "pf2e-holodeck",
                    databases: {
                        combatHistory: hDb,
                        holodeckHistory: sDb,
                        explorationHistory: eDb
                    }
                };

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", `combat-forensics-backup-${new Date().toISOString().split('T')[0]}.json`);
                document.body.appendChild(downloadAnchorNode); 
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                ui.notifications.info("Combat Forensics | JSON download initiated.");
            },
            importData: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can import archives.");

                const journals = game.journal.contents.filter(j => j.flags?.["pf2e-holodeck"]?.archiveData);
                let journalOptions = journals.map(j => `<option value="${j.id}">${j.name}</option>`).join("");
                
                let journalHtml = journals.length > 0 
                    ? `<div class="form-group" style="margin-bottom: 10px;">
                           <label style="font-weight: bold; color: #44aaff; display:block; margin-bottom:4px;">From Journal Archive:</label>
                           <div style="display:flex; gap: 5px;">
                               <select id="import-journal-select" style="flex:1; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                   ${journalOptions}
                               </select>
                               <button id="btn-import-journal" style="flex: 0 0 auto; background: #113355; border: 1px solid #44aaff; color: #fff;">Load Journal</button>
                           </div>
                       </div>` 
                    : `<div style="color: #888; font-style: italic; margin-bottom: 10px;">No Journal Archives found. Export first.</div>`;

                const content = `
                    <div style="background: #0f0f15; color: #eee; padding: 15px; border: 1px solid #444; border-radius: 4px; font-family: 'Signika', sans-serif;">
                        <p style="margin-top: 0; color: #ccc; font-size: 0.9em;">Importing will safely append archived encounters into your current databases.</p>
                        ${journalHtml}
                        <hr style="border: 0; border-top: 1px dashed #444; margin: 15px 0;">
                        <div class="form-group">
                            <label style="font-weight: bold; color: #aa44ff; display:block; margin-bottom:4px;">From Local JSON File:</label>
                            <button id="btn-import-json" style="width: 100%; background: #331133; border: 1px solid #aa44ff; color: #fff; padding: 8px;">
                                <i class="fas fa-upload"></i> Select & Upload JSON Backup
                            </button>
                            <input type="file" id="json-upload-input" accept=".json" style="display: none;">
                        </div>
                    </div>
                `;

                const processImport = async (data) => {
                    if (!data || (!data.combatHistory && !data.combat && !data.explorationHistory && !data.holodeckHistory)) {
                        return ui.notifications.error("Combat Forensics | Invalid archive data format.");
                    }

                    const safeMergeDb = async (settingName, newData) => {
                        if (!newData || Object.keys(newData).length === 0) return;
                        let current = game.settings.get('pf2e-holodeck', settingName) || {};
                        let updated = { ...current };
                        for (const [key, value] of Object.entries(newData)) {
                            updated[key] = value;
                        }
                        await game.settings.set('pf2e-holodeck', settingName, updated);
                    };

                    await safeMergeDb('combatHistory', data.combatHistory || data.combat);
                    await safeMergeDb('explorationHistory', data.explorationHistory || data.exploration);
                    await safeMergeDb('holodeckHistory', data.holodeckHistory || data.sim);

                    ui.notifications.info("Combat Forensics | Data successfully imported and merged.");
                    this.render({parts: ["main"]});
                };

                let d = new Dialog({
                    title: "Import Combat Archives",
                    content: content,
                    render: (html) => {
                        html.find('#btn-import-journal').click(async (e) => {
                            e.preventDefault();
                            const jId = html.find('#import-journal-select').val();
                            const journal = game.journal.get(jId);
                            if (journal) {
                                const archiveData = journal.flags["pf2e-holodeck"].archiveData;
                                await processImport(archiveData);
                                d.close();
                            }
                        });

                        html.find('#btn-import-json').click((e) => {
                            e.preventDefault();
                            html.find('#json-upload-input').click();
                        });

                        html.find('#json-upload-input').change((e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async (ev) => {
                                try {
                                    const json = JSON.parse(ev.target.result);
                                    const data = json.databases || json; 
                                    await processImport(data);
                                    d.close();
                                } catch (err) {
                                    ui.notifications.error("Combat Forensics | Failed to parse JSON file.");
                                    console.error(err);
                                }
                            };
                            reader.readAsText(file);
                        });
                    },
                    buttons: { close: { icon: '<i class="fas fa-times"></i>', label: "Close" } }
                }, { width: 450 }).render(true);
            }
        }
    };

    static PARTS = { main: { template: "modules/pf2e-holodeck/templates/analytics.hbs" } };

    _onRender(context, options) {
        super._onRender(context, options);
        const selector = this.element.querySelector('#analytics-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.selectedEncounter = e.target.value;
                this.expandedLogs = {}; 
                this.expandedActors = {};
                this.render({parts: ["main"]});
            });
        }

        this.expandedLogs = this.expandedLogs || {};
        this.expandedActors = this.expandedActors || {};

        this.element.querySelectorAll('details.holodeck-action-card').forEach(d => {
            d.addEventListener('toggle', (e) => {
                if (e.target.open) this.expandedLogs[e.target.dataset.logId] = true;
                else delete this.expandedLogs[e.target.dataset.logId];
            });
        });

        this.element.querySelectorAll('details.holodeck-actor-overview').forEach(d => {
            d.addEventListener('toggle', (e) => {
                if (e.target.open) this.expandedActors[e.target.dataset.actor] = true;
                else delete this.expandedActors[e.target.dataset.actor];
            });
        });
    }

    async _prepareContext(options) {
        if (!this.selectedEncounter) {
            const isCombatActive = (canvas.scene && canvas.scene.getFlag('pf2e-holodeck', 'active')) || (game.combat && game.combat.active && game.combat.started);
            this.selectedEncounter = isCombatActive ? "current" : "exploration";
        }
        
        this.viewMode = this.viewMode || "overview";
        const isMeta = this.selectedEncounter.startsWith("meta");
        const isExploration = this.selectedEncounter === "exploration" || this.selectedEncounter.startsWith("meta-explore") || this.selectedEncounter.startsWith("[EXPLORE]");
        const isGM = game.user.isGM;

        const canAudit = game.user.role >= (game.settings.get('pf2e-holodeck', 'auditPermission') || 4);
        const showAdvanced = !(game.settings.get('pf2e-holodeck', 'simplifiedMetrics') || false);

        const historyDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
        const exploreDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
        const simDb = isGM ? (game.settings.get('pf2e-holodeck', 'holodeckHistory') || {}) : {};
        
        const historyKeys = Object.keys(historyDb).reverse(); 
        const exploreKeys = Object.keys(exploreDb).reverse(); 
        const simKeys = Object.keys(simDb).reverse(); 

        let activeLedger = { actors: {}, masterLog: [], totalDamage: 0, maxRounds: 1 };

        if (isMeta) {
            let targetDb = historyDb;
            if (this.selectedEncounter === "meta-sim") targetDb = simDb;
            if (this.selectedEncounter === "meta-explore") targetDb = exploreDb;
            
            let cumulativeRounds = 0;
            
            Object.entries(targetDb).forEach(([encounterName, encounter]) => {
                let encMaxRounds = encounter.maxRounds || 1;
                
                let safeMasterLog = Array.isArray(encounter.masterLog) ? encounter.masterLog : Object.values(encounter.masterLog || {});

                if (safeMasterLog && safeMasterLog.length > 0) {
                    activeLedger.masterLog.push({ isDivider: true, encounterName: encounterName, round: cumulativeRounds + 1 });
                    
                    safeMasterLog.forEach(log => {
                        let adjustedLog = foundry.utils.deepClone(log);
                        adjustedLog.round += cumulativeRounds; 
                        activeLedger.masterLog.push(adjustedLog);
                    });
                }

                Object.values(encounter.actors || {}).forEach(a => {
                    let trueName = a.name || "Unknown";
                    if (!activeLedger.actors[trueName]) {
                        activeLedger.actors[trueName] = { 
                            name: trueName, type: a.type, level: a.level, isAlly: a.isAlly,
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                        };
                    }
                    let m = activeLedger.actors[trueName];
                    m.isAlly = m.isAlly || a.isAlly || a.type === "character" || a.type === "familiar";
                    m.damageDealt += (a.damageDealt || 0); m.healingDealt += (a.healingDealt || 0); m.hits += (a.hits || 0); m.misses += (a.misses || 0);
                    m.crits += (a.crits || 0); m.critMisses += (a.critMisses || 0); m.nat1s += (a.nat1s || 0); m.nat20s += (a.nat20s || 0);
                    m.kills += (a.kills || 0); m.mitigated += (a.mitigated || 0); m.heroPoints += (a.heroPoints || 0); m.heroPointCrits += (a.heroPointCrits || 0);
                    m.expectedDamage = (m.expectedDamage || 0) + (a.expectedDamage || 0);
                    m.actualDamageRoll = (m.actualDamageRoll || 0) + (a.actualDamageRoll || 0);
                    
                    let safeTurnTimes = Array.isArray(a.turnTimes) ? a.turnTimes : Object.values(a.turnTimes || {});
                    if (safeTurnTimes.length) m.turnTimes.push(...safeTurnTimes);

                    let safeD20s = Array.isArray(a.d20Rolls) ? a.d20Rolls : Object.values(a.d20Rolls || {});
                    if (safeD20s.length) { for (let i = 0; i < 20; i++) { m.d20Rolls[i] += (safeD20s[i] || 0); } }
                    
                    if (a.damageTypes) {
                        for (let [dt, dData] of Object.entries(a.damageTypes)) {
                            if (!m.damageTypes[dt]) m.damageTypes[dt] = { instances: 0, total: 0 };
                            if (typeof dData === 'number') {
                                m.damageTypes[dt].total += dData;
                                m.damageTypes[dt].instances += 1;
                            } else {
                                m.damageTypes[dt].total += dData.total;
                                m.damageTypes[dt].instances += dData.instances;
                            }
                        }
                    }
                    
                    let safeHistory = Array.isArray(a.history) ? a.history : Object.values(a.history || {});
                    if (safeHistory.length) {
                        let adjustedHistory = safeHistory.map(h => ({...h, round: h.round + cumulativeRounds}));
                        m.history.push(...adjustedHistory);
                    }
                    if (a.type === "character" || a.type === "familiar") m.type = a.type;
                });
                
                activeLedger.totalDamage += (encounter.totalDamage || 0);
                cumulativeRounds += encMaxRounds;
            });
            activeLedger.maxRounds = cumulativeRounds || 1;
            
        } else if (this.selectedEncounter === "current") {
            if (!isGM && canvas.scene?.getFlag('pf2e-holodeck', 'active')) {} 
            else activeLedger = window.CombatParser.ledger;
        } else if (this.selectedEncounter === "exploration") {
            activeLedger = window.CombatParser.explorationLedger;
        } else {
            activeLedger = historyDb[this.selectedEncounter] || exploreDb[this.selectedEncounter] || simDb[this.selectedEncounter] || activeLedger;
        }

        if (activeLedger.masterLog && !Array.isArray(activeLedger.masterLog)) {
            activeLedger.masterLog = Object.values(activeLedger.masterLog);
        }
        Object.values(activeLedger.actors).forEach(a => {
            if (a.history && !Array.isArray(a.history)) a.history = Object.values(a.history);
            if (a.turnTimes && !Array.isArray(a.turnTimes)) a.turnTimes = Object.values(a.turnTimes);
            if (a.d20Rolls && !Array.isArray(a.d20Rolls)) a.d20Rolls = Object.values(a.d20Rolls);
        });

        let needsMigrationSave = false;
        activeLedger.masterLog.forEach(log => {
            if (!log.isDivider && !log.isTurnSummary && !log.id) {
                log.id = foundry.utils.randomID();
                let stats = activeLedger.actors[log.source];
                if (stats && stats.history) {
                    let hist = stats.history.find(h => h.round === log.round && h.name === log.name && h.type === log.type && !h.id);
                    if (hist) hist.id = log.id;
                }
                needsMigrationSave = true;
            }
        });

        if (needsMigrationSave && isGM && !isMeta && this.selectedEncounter !== "current" && this.selectedEncounter !== "exploration") {
            let hDb = foundry.utils.deepClone(historyDb);
            let eDb = foundry.utils.deepClone(exploreDb);
            let sDb = foundry.utils.deepClone(simDb);
            
            if (hDb[this.selectedEncounter]) { 
                hDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'combatHistory', hDb); 
            } else if (eDb[this.selectedEncounter]) { 
                eDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'explorationHistory', eDb); 
            } else if (sDb[this.selectedEncounter]) { 
                sDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'holodeckHistory', sDb); 
            }
        }

        let maxRounds = activeLedger.maxRounds || 1;
        let totalDamage = activeLedger.totalDamage || 1;
        
        let logCounter = 0;
        let partyActions = 0, enemyActions = 0;

        const formatTime = (secs) => {
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return m > 0 ? `${m}m ${s}s` : `${s}s`;
        };

        let processedLogs = activeLedger.masterLog.map(log => {
            if (log.isDivider) return log; 
            
            let actorData = activeLedger.actors[log.source];
            let isParty = actorData ? actorData.isAlly : false;

            if (log.isTurnSummary) {
                return { ...log, isParty: isParty, formattedTime: formatTime(log.duration) };
            }

            let parts = log.name ? log.name.split(/(?: - | \| )/) : [""];
            let mainTitle = parts[0] ? parts[0].trim() : "";
            
            if (!mainTitle) {
                if (log.type === "Damage") mainTitle = "Damage Application";
                else if (log.type === "Roll") mainTitle = "Dice Roll";
                else mainTitle = "Action";
            }
            
            let tags = log.tags && log.tags.length > 0 ? log.tags : parts.slice(1).map(p => p.trim()).filter(p => p);
            
            if (log.tags && log.tags.length > 0) {
                parts.slice(1).forEach(p => {
                    let pt = p.trim();
                    if (pt && !tags.includes(pt)) tags.push(pt);
                });
            }
            
            if (isParty) partyActions++;
            else enemyActions++;

            let isSuspect = false;
            let suspectReason = "";
            let targetData = activeLedger.actors[log.target];
            let hasValidTarget = log.target && log.target !== "None" && log.target !== "Unknown / AoE";
            
            if (log.source !== "Environment" && targetData && hasValidTarget) {
                let isTargetParty = targetData.isAlly;
                if (log.type === "Damage") {
                    if (isParty === isTargetParty) {
                        isSuspect = true;
                        suspectReason = log.source === log.target ? "Self-Harm: Attacker damaged themselves." : "Friendly Fire: Damaged an allied combatant.";
                    }
                } else if (log.type === "Heal") {
                    if (isParty !== isTargetParty) {
                        isSuspect = true;
                        suspectReason = "Traitor Healing: Restored HP to an enemy combatant.";
                    }
                }
            }

            return { ...log, mainTitle, tags, isParty, isSuspect, suspectReason, hasValidTarget };
        });

        processedLogs.forEach(l => {
            if (l.round > maxRounds) maxRounds = l.round;
        });

        let rounds = [];
        let partyDamagePerRound = [];
        let enemyDamagePerRound = [];
        let maxGraphDamage = 10; 

        for (let i = 1; i <= maxRounds; i++) {
            let rLogs = processedLogs.filter(l => l.round === i);
            let pDmg = 0; let eDmg = 0;

            if (rLogs.length > 0) rounds.push({ roundNumber: i, logs: rLogs });

            rLogs.forEach(l => {
                if (l.type === "Damage") {
                    if (l.isParty) pDmg += l.damageVal;
                    else eDmg += l.damageVal;
                }
            });

            partyDamagePerRound.push(pDmg);
            enemyDamagePerRound.push(eDmg);
            
            if (pDmg > maxGraphDamage) maxGraphDamage = pDmg;
            if (eDmg > maxGraphDamage) maxGraphDamage = eDmg;
        }

        const pcs = [];
        const npcs = [];
        
        let luckiest = { name: "None", avg: 0 };
        let unluckiest = { name: "None", avg: 21 };
        let partyActualDmg = 0, partyExpectedDmg = 0;
        let enemyActualDmg = 0, enemyExpectedDmg = 0;
        let enemyDamageTypesPool = {};
        
        let partyTurnTotalSeconds = 0;
        let partyTurnCount = 0;
        let enemyTurnTotalSeconds = 0;
        let enemyTurnCount = 0;

        let totalCombatTimeSeconds = 0;
        let pcTimeMap = {};
        let gmTimeTotal = 0;

        Object.values(activeLedger.actors).forEach(a => {
            const rawRolls = a.d20Rolls || Array(20).fill(0);
            
            let totalD20Sum = 0;
            let totalD20sRolled = 0;
            rawRolls.forEach((count, idx) => {
                totalD20Sum += (idx + 1) * count;
                totalD20sRolled += count;
            });
            
            let avgD20Val = totalD20sRolled > 0 ? (totalD20Sum / totalD20sRolled) : 0;
            let avgD20Display = totalD20sRolled > 0 ? avgD20Val.toFixed(1) : "N/A";
            
            if (totalD20sRolled >= 3) {
                if (avgD20Val > luckiest.avg) luckiest = { name: a.name, avg: avgD20Val };
                if (avgD20Val < unluckiest.avg) unluckiest = { name: a.name, avg: avgD20Val };
            }
            
            const totalAttacks = a.hits + a.misses + a.crits + a.critMisses;
            const accuracy = totalAttacks > 0 ? Math.round(((a.hits + a.crits) / totalAttacks) * 100) : 0;
            const damagePercent = Math.round((a.damageDealt / totalDamage) * 100);
            const dpr = Math.round(a.damageDealt / maxRounds);
            const successRate = accuracy; 
            const totalChecks = Math.max(totalAttacks, totalD20sRolled);

            let isAlly = a.isAlly;

            let tSum = 0;
            let tCount = 0;
            let maxTime = 0;
            if (a.turnTimes) {
                a.turnTimes.forEach(s => {
                    tSum += s;
                    tCount++;
                    if (s > maxTime) maxTime = s;
                });
            }
            
            totalCombatTimeSeconds += tSum;
            if (isAlly) {
                pcTimeMap[a.name] = (pcTimeMap[a.name] || 0) + tSum;
            } else {
                gmTimeTotal += tSum;
            }

            let totalTurnTimeStr = formatTime(tSum);
            let avgTurnTimeStr = tCount > 0 ? formatTime(Math.round(tSum/tCount)) : "0s";
            let maxTurnTimeStr = maxTime > 0 ? formatTime(maxTime) : "0s";

            const d20Max = Math.max(...rawRolls, 1);
            const d20Graph = rawRolls.map((count, index) => {
                const val = index + 1;
                let color = "#44aaff";
                if (val === 1) color = "#ff6666";
                if (val === 20) color = "#ffcc00";
                return { value: val, count: count, height: Math.round((count / d20Max) * 100), color: color };
            });

            let abilityTotals = {};
            let actionDamageMap = {};
            let actionHealMap = {};
            
            if (a.history) {
                a.history.forEach(h => {
                    let aName = h.name || "Unknown";
                    if (!abilityTotals[aName]) abilityTotals[aName] = { name: aName, damage: 0, healing: 0, casts: 0, damageInstances: 0 };
                    
                    if (h.type === "Damage" || h.type === "Mitigation") {
                        let key = `${h.round}_${h.name}`;
                        if (!actionDamageMap[key]) actionDamageMap[key] = 0;
                        actionDamageMap[key] += h.damageVal;
                        abilityTotals[aName].damage += h.damageVal;
                        if (h.damageVal > 0) abilityTotals[aName].damageInstances += 1;
                    }
                    if (h.type === "Heal") {
                        let key = `${h.round}_${h.name}`;
                        if (!actionHealMap[key]) actionHealMap[key] = 0;
                        actionHealMap[key] += h.healVal;
                        abilityTotals[aName].healing += h.healVal;
                    }
                    if (h.type === "Roll" || h.type === "Attack" || h.type === "Save" || h.type === "Skill") {
                        abilityTotals[aName].casts += 1;
                    } else if (h.damageVal === 0 && h.healVal === 0) {
                        abilityTotals[aName].casts += 1;
                    }
                });
            }
            
            let abilityBreakdown = Object.values(abilityTotals)
                .filter(ab => ab.damage > 0 || ab.healing > 0 || ab.casts > 0)
                .map(ab => {
                    return { 
                        ...ab, 
                        dmgPct: a.damageDealt > 0 ? Math.round((ab.damage / a.damageDealt) * 100) : 0,
                        hasBoth: ab.damage > 0 && ab.healing > 0
                    };
                })
                .sort((x, y) => (y.damage + y.healing) - (x.damage + x.healing));

            let maxDamageDealt = 0;
            Object.values(actionDamageMap).forEach(v => { if (v > maxDamageDealt) maxDamageDealt = v; });
            let maxHealDealt = 0;
            Object.values(actionHealMap).forEach(v => { if (v > maxHealDealt) maxHealDealt = v; });

            let takenDamageMap = {};
            activeLedger.masterLog.forEach(log => {
                if (!log.isDivider && log.target === a.name && (log.type === "Damage" || log.type === "Mitigation")) {
                    let key = `${log.round}_${log.source}_${log.name}`;
                    if (!takenDamageMap[key]) takenDamageMap[key] = 0;
                    takenDamageMap[key] += log.damageVal;
                }
            });
            let maxDamageTaken = 0;
            Object.values(takenDamageMap).forEach(v => { if (v > maxDamageTaken) maxDamageTaken = v; });

            let mostRolledNumber = "N/A";
            const maxRollCount = Math.max(...rawRolls);
            if (maxRollCount > 0) {
                const frequentRolls = [];
                rawRolls.forEach((count, idx) => { if (count === maxRollCount) frequentRolls.push(idx + 1); });
                mostRolledNumber = frequentRolls.join(', ');
            }
            
            if (isAlly) {
                partyActualDmg += (a.actualDamageRoll || 0);
                partyExpectedDmg += (a.expectedDamage || 0);
                partyTurnTotalSeconds += tSum;
                partyTurnCount += tCount;
            } else {
                enemyActualDmg += (a.actualDamageRoll || 0);
                enemyExpectedDmg += (a.expectedDamage || 0);
                enemyTurnTotalSeconds += tSum;
                enemyTurnCount += tCount;
                if (a.damageTypes) {
                    for (let [dt, dData] of Object.entries(a.damageTypes)) {
                        if (!enemyDamageTypesPool[dt]) enemyDamageTypesPool[dt] = { instances: 0, total: 0 };
                        if (typeof dData === 'number') {
                            enemyDamageTypesPool[dt].instances += 1;
                            enemyDamageTypesPool[dt].total += dData;
                        } else {
                            enemyDamageTypesPool[dt].instances += (dData.instances || 0);
                            enemyDamageTypesPool[dt].total += (dData.total || 0);
                        }
                    }
                }
            }

            const combatantData = { 
                ...a, damagePercent, dpr, healingDealt: a.healingDealt || 0, accuracy, d20Graph, 
                maxDamageDealt, maxDamageTaken, maxHealDealt, avgD20Display, totalChecks, successRate, totalTurnTimeStr, avgTurnTimeStr, maxTurnTimeStr, isAlly,
                abilityBreakdown,
                logs: processedLogs.filter(l => !l.isDivider && !l.isTurnSummary && l.source === a.name)
            };
            
            if (isAlly) pcs.push(combatantData);
            else if (isGM || showAdvanced) npcs.push(combatantData); 
        });
        
        pcs.sort((a, b) => b.damageDealt - a.damageDealt);
        npcs.sort((a, b) => b.damageDealt - a.damageDealt);
        
        let actorGroups = [];
        [...pcs, ...npcs].forEach(a => {
            let aLogs = processedLogs.filter(l => !l.isDivider && !l.isTurnSummary && l.source === a.name);
            actorGroups.push({ 
                name: a.name, 
                isParty: a.isAlly, 
                canViewActor: a.isAlly || isGM || showAdvanced,
                logs: aLogs,
                totalTurnTimeStr: a.totalTurnTimeStr,
                avgTurnTimeStr: a.avgTurnTimeStr,
                maxTurnTimeStr: a.maxTurnTimeStr,
                abilityBreakdown: a.abilityBreakdown
            });
        });
        actorGroups.sort((a, b) => b.isParty - a.isParty);

        let timeEntries = [];
        if (gmTimeTotal > 0) timeEntries.push({ name: "GM / Enemies", time: gmTimeTotal, color: "#ff4444" });
        let pcColors = ["#44aaff", "#44ffaa", "#ffff44", "#aa44ff", "#ffaa00", "#ff44aa", "#44ffff", "#ffffff"];
        let pColorIdx = 0;
        
        Object.entries(pcTimeMap).sort((a,b) => b[1] - a[1]).forEach(([name, time]) => {
            if (time > 0) {
                timeEntries.push({ name: name, time: time, color: pcColors[pColorIdx % pcColors.length] });
                pColorIdx++;
            }
        });

        let timePieSlices = [];
        let timeLegendItems = [];
        let timeCumulativeAngle = 0;

        if (totalCombatTimeSeconds > 0) {
            timeEntries.forEach(entry => {
                let pctTime = (entry.time / totalCombatTimeSeconds) * 100;
                let tooltip = `${entry.name} | Total Time: ${formatTime(entry.time)} (${pctTime.toFixed(1)}%)`;
                let sliceAngle = (entry.time / totalCombatTimeSeconds) * (Math.PI * 2);

                if (entry.time === totalCombatTimeSeconds) {
                    timePieSlices.push({ isFull: true, color: entry.color, tooltip });
                } else {
                    let startX = 50 + 50 * Math.cos(timeCumulativeAngle);
                    let startY = 50 + 50 * Math.sin(timeCumulativeAngle);
                    timeCumulativeAngle += sliceAngle;
                    let endX = 50 + 50 * Math.cos(timeCumulativeAngle);
                    let endY = 50 + 50 * Math.sin(timeCumulativeAngle);
                    let largeArc = sliceAngle > Math.PI ? 1 : 0;
                    let path = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`;
                    timePieSlices.push({ isFull: false, path, color: entry.color, tooltip });
                }
                timeLegendItems.push({ name: entry.name, color: entry.color, tooltip, formattedTime: formatTime(entry.time) });
            });
        }

        let partyPaceStr = partyTurnCount > 0 ? formatTime(Math.round(partyTurnTotalSeconds/partyTurnCount)) : "N/A";
        let enemyPaceStr = enemyTurnCount > 0 ? formatTime(Math.round(enemyTurnTotalSeconds/enemyTurnCount)) : "N/A";

        let partySkew = partyExpectedDmg > 0 ? Math.round(((partyActualDmg / partyExpectedDmg) - 1) * 100) : 0;
        let enemySkew = enemyExpectedDmg > 0 ? Math.round(((enemyActualDmg / enemyExpectedDmg) - 1) * 100) : 0;
        
        let totalEnemyInstances = 0;
        let totalEnemyTypedDamage = 0;
        Object.values(enemyDamageTypesPool).forEach(d => {
            totalEnemyInstances += d.instances;
            totalEnemyTypedDamage += d.total;
        });

        let pieSlices = [];
        let legendItems = [];
        let colors = ["#ff4444", "#44aaff", "#ffaa00", "#aa44ff", "#44ffaa", "#ff44aa", "#ffff44", "#44ffff"];
        let colorIndex = 0;
        let cumulativeAngle = 0; 
        
        let sortedEnemyTypes = Object.entries(enemyDamageTypesPool).sort((a,b) => b[1].instances - a[1].instances);

        if (totalEnemyInstances > 0) {
            sortedEnemyTypes.forEach(([dt, dData]) => {
                let pctInstances = (dData.instances / totalEnemyInstances) * 100;
                let pctDamage = totalEnemyTypedDamage > 0 ? (dData.total / totalEnemyTypedDamage) * 100 : 0;
                let tooltip = `${dt.toUpperCase()} | Instances: ${dData.instances} (${pctInstances.toFixed(1)}%) | Dmg: ${dData.total} (${pctDamage.toFixed(1)}%)`;
                let sliceAngle = (dData.instances / totalEnemyInstances) * (Math.PI * 2);
                
                if (dData.instances === totalEnemyInstances) {
                    pieSlices.push({ isFull: true, color: colors[colorIndex % colors.length], tooltip });
                } else {
                    let startX = 50 + 50 * Math.cos(cumulativeAngle);
                    let startY = 50 + 50 * Math.sin(cumulativeAngle);
                    cumulativeAngle += sliceAngle;
                    let endX = 50 + 50 * Math.cos(cumulativeAngle);
                    let endY = 50 + 50 * Math.sin(cumulativeAngle);
                    let largeArc = sliceAngle > Math.PI ? 1 : 0;
                    let path = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`;
                    pieSlices.push({ isFull: false, path, color: colors[colorIndex % colors.length], tooltip });
                }
                legendItems.push({ name: dt.toUpperCase(), color: colors[colorIndex % colors.length], tooltip });
                colorIndex++;
            });
        }

        let difficultyStr = "Trivial";
        let diffColor = "#44ff44"; 
        let totalXP = 0, partyLevel = 1, partySize = 4;
        let truePcs = pcs.filter(p => p.type === "character"); 
        
        if (isMeta) {
            difficultyStr = "Meta Aggregate";
            diffColor = "#ffaa00";
        } else if (truePcs.length === 0) {
            difficultyStr = "N/A (No PCs)";
            diffColor = "#888";
        } else {
            partySize = truePcs.length;
            partyLevel = Math.max(...truePcs.map(p => parseInt(p.level) || 1));
            
            npcs.forEach(npc => {
                let levelDiff = (parseInt(npc.level) || 0) - partyLevel;
                if (levelDiff < -4) totalXP += 0; 
                else if (levelDiff === -4) totalXP += 10;
                else if (levelDiff === -3) totalXP += 15;
                else if (levelDiff === -2) totalXP += 20;
                else if (levelDiff === -1) totalXP += 30;
                else if (levelDiff === 0) totalXP += 40;
                else if (levelDiff === 1) totalXP += 60;
                else if (levelDiff === 2) totalXP += 80;
                else if (levelDiff === 3) totalXP += 120;
                else if (levelDiff >= 4) totalXP += 160;
            });

            let adj = partySize - 4;
            let trivial = 40 + (adj * 10), low = 60 + (adj * 15), mod = 80 + (adj * 20), sev = 120 + (adj * 30), ext = 160 + (adj * 40);

            if (totalXP >= ext) { difficultyStr = "Extreme"; diffColor = "#ff4444"; } 
            else if (totalXP >= sev) { difficultyStr = "Severe"; diffColor = "#ff6600"; } 
            else if (totalXP >= mod) { difficultyStr = "Moderate"; diffColor = "#ffaa00"; } 
            else if (totalXP >= low) { difficultyStr = "Low"; diffColor = "#aaff44"; } 
            else { difficultyStr = "Trivial"; diffColor = "#44ff44"; }
        }

        let partyPoints = [], enemyPoints = [], pDots = [], eDots = [], xLabels = [];
        let usableWidth = 700, usableHeight = 110, xOffset = 30, yOffset = 130; 

        for (let i = 0; i < maxRounds; i++) {
            let x = maxRounds === 1 ? (usableWidth / 2) + xOffset : (i / (maxRounds - 1)) * usableWidth + xOffset;
            let pY = yOffset - ((partyDamagePerRound[i] || 0) / maxGraphDamage) * usableHeight;
            let eY = yOffset - ((enemyDamagePerRound[i] || 0) / maxGraphDamage) * usableHeight;

            partyPoints.push(`${x},${pY}`);
            enemyPoints.push(`${x},${eY}`);
            pDots.push({x, y: pY});
            eDots.push({x, y: eY});
            xLabels.push({ x: x, round: i + 1 });
        }

        return { 
            hasData: Object.keys(activeLedger.actors).length > 0,
            isGM, canAudit, showAdvanced, isExploration, isMeta, viewMode: this.viewMode,
            pcs, npcs, rounds, actorGroups,
            historyKeys, exploreKeys, simKeys, selectedEncounter: this.selectedEncounter,
            expandedLogs: this.expandedLogs || {}, expandedActors: this.expandedActors || {},
            stats: {
                partyCount: pcs.length, enemyCount: npcs.length,
                partyActions, enemyActions, difficultyStr, diffColor, partyLevel, partySize, totalXP,
                totalEncounterTimeStr: formatTime(totalCombatTimeSeconds)
            },
            pitBoss: {
                luckiestName: luckiest.avg > 0 ? luckiest.name : "N/A",
                luckiestAvg: luckiest.avg > 0 ? luckiest.avg.toFixed(1) : "-",
                unluckiestName: unluckiest.avg < 21 ? unluckiest.name : "N/A",
                unluckiestAvg: unluckiest.avg < 21 ? unluckiest.avg.toFixed(1) : "-",
                partySkewStr: partySkew > 0 ? `+${partySkew}%` : `${partySkew}%`,
                partySkewColor: partySkew > 0 ? "#44ff44" : (partySkew < 0 ? "#ff6666" : "#888"),
                enemySkewStr: enemySkew > 0 ? `+${enemySkew}%` : `${enemySkew}%`,
                enemySkewColor: enemySkew > 0 ? "#44ff44" : (enemySkew < 0 ? "#ff6666" : "#888"),
                pieSlices, legendItems, partyPaceStr, enemyPaceStr,
                timePieSlices, timeLegendItems
            },
            graph: {
                partyPoints: partyPoints.join(" "), enemyPoints: enemyPoints.join(" "),
                pDots, eDots, xLabels, maxDamage: maxGraphDamage, halfDamage: Math.round(maxGraphDamage / 2)
            }
        };
    }
}
window.CombatForensicsApp = CombatForensicsApp;

Hooks.once('init', () => {
    game.settings.register('pf2e-holodeck', 'simplifiedMetrics', {
        name: "Simplified Metrics",
        hint: "Hides advanced analytics (Pit Boss charts, ability profiles) to focus only on raw damage and rolls. Ideal for keeping the UI clean for players.",
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });
    
    game.settings.register('pf2e-holodeck', 'auditPermission', {
        name: "Attribution Audit Role",
        hint: "The minimum Foundry user role allowed to reassign timeline damage and swap actor allegiances.",
        scope: 'world',
        config: true,
        type: Number,
        choices: { 1: "Player", 2: "Trusted Player", 3: "Assistant GM", 4: "Game Master" },
        default: 4
    });

    game.keybindings.register('pf2e-holodeck', 'toggle-analytics', {
        name: "Toggle Combat Forensics",
        hint: "Instantly opens or closes the Combat Forensics dashboard.",
        editable: [{ key: "KeyA", modifiers: ["Shift"] }],
        restricted: true, 
        onDown: () => {
            if (!window.combatForensicsInstance) window.combatForensicsInstance = new window.CombatForensicsApp();
            if (window.combatForensicsInstance.rendered) window.combatForensicsInstance.close();
            else window.combatForensicsInstance.render({force: true});
            return true; 
        }
    });
});

Hooks.once('ready', () => {
    window.CombatParser.restoreLiveBackup();
    if (game.user.isGM) setInterval(() => { window.CombatParser.saveExplorationArchive(); }, 30 * 60 * 1000); 
});

Hooks.on('canvasReady', () => {
    if (game.user.isGM) window.CombatParser.saveExplorationArchive();
});

Hooks.on('createChatMessage', (message) => {
    if (!message || !message.id) return;
    if (message.flags?.core?.initiativeRoll || message.flavor?.toLowerCase().includes("initiative")) return;

    const isSecret = (message.whisper && message.whisper.length > 0) || message.blind;
    const isHolodeck = canvas.scene?.getFlag('pf2e-holodeck', 'active');
    if (isSecret && !isHolodeck) return;

    const systemFlags = message.flags?.pf2e || message.flags?.sf2e || {};
    const context = systemFlags.context || {};
    const fullText = `${message.flavor || ""} ${message.content || ""}`.toLowerCase();
    
    const isDamageTaken = context.type === "damage-taken";
    const isAttackOrSave = context.type === "attack-roll" || context.type === "saving-throw";
    const isSkillOrPerception = context.type === "skill-check" || context.type === "perception-check";
    const isDamageRoll = message.isDamageRoll || context.type === "damage-roll";
    const hasAppliedDamage = !!systemFlags.appliedDamage;
    const isNarrative = /(?:takes|taking|unscathed|absorbing|healed|restored|reduced by|mitigated|kills them|healing)/.test(fullText);

    if (!isDamageTaken && !isAttackOrSave && !isSkillOrPerception && !isDamageRoll && !hasAppliedDamage && !isNarrative) return;

    window.CombatParser.parseMessage(message);

    if (isHolodeck && game.user.isGM && !isSecret && (hasAppliedDamage || isDamageTaken || isNarrative)) {
        message.delete();
    }

    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) window.combatForensicsInstance.render();
});

Hooks.on('updateCombat', (combat, changed) => {
    if (!game.user.isGM) return;
    const activeLedger = window.CombatParser.ledger;
    if (combat.round > activeLedger.maxRounds) activeLedger.maxRounds = combat.round;

    // ONLY touch the stopwatch if the turn, round, or combat state explicitly changes
    if (changed.turn !== undefined || changed.round !== undefined || changed.started === false) {
        
        // 1. Stop the clock for the outgoing combatant
        if (activeLedger.currentTurnStart && activeLedger.currentCombatant) {
            const duration = Math.round((Date.now() - activeLedger.currentTurnStart) / 1000);
            const cName = activeLedger.currentCombatant;
            if (activeLedger.actors[cName] && duration >= 0 && duration < 1200) {
                activeLedger.actors[cName].turnTimes.push(duration);
                activeLedger.masterLog.push({
                    isTurnSummary: true, source: cName, duration: duration, round: activeLedger.currentTurnRound || combat.round, type: "Time"
                });
            }
        }

        // 2. Start the clock for the incoming combatant
        if (combat.started && combat.combatant && changed.started !== false) {
            activeLedger.currentTurnStart = Date.now();
            const c = combat.combatant;
            let rawName = c ? c.name : null;
            let canonicalName = c ? window.CombatParser.getCanonicalName(c.actor, rawName) : null;
            activeLedger.currentCombatant = canonicalName ? window.CombatParser.resolveOwner(canonicalName, c.actor) : null;
            activeLedger.currentTurnRound = combat.round;
        } else {
            activeLedger.currentTurnStart = null;
            activeLedger.currentCombatant = null;
            activeLedger.currentTurnRound = null;
        }
    }

    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "current";
        window.combatForensicsInstance.render(true);
    }
    
    window.CombatParser.saveLiveBackup();
});

Hooks.on('combatStart', (combat, updateData) => {
    if (game.user.isGM) {
        window.CombatParser.saveExplorationArchive(); 
        window.CombatParser.resetLedger(); 
        window.CombatParser.seedCombatants(combat);
        
        window.CombatParser.ledger.currentTurnStart = Date.now();
        const c = combat.combatant;
        let rawName = c ? c.name : null;
        let canonicalName = c ? window.CombatParser.getCanonicalName(c.actor, rawName) : null;
        window.CombatParser.ledger.currentCombatant = canonicalName ? window.CombatParser.resolveOwner(canonicalName, c?.actor) : null;
        window.CombatParser.ledger.currentTurnRound = combat.round || 1;
    }
    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "current";
        window.combatForensicsInstance.render(true);
    }
});

Hooks.on('createCombatant', (combatant, options, id) => {
    if (game.user.isGM && combatant.parent && combatant.parent.started) {
        window.CombatParser.seedCombatants(combatant.parent);
        if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) window.combatForensicsInstance.render();
    }
});

Hooks.on('deleteCombat', async (combat) => { 
    if (game.user.isGM) {
        const activeLedger = window.CombatParser.ledger;
        if (activeLedger.currentTurnStart && activeLedger.currentCombatant) {
             const duration = Math.round((Date.now() - activeLedger.currentTurnStart) / 1000);
             const cName = activeLedger.currentCombatant;
             if (activeLedger.actors[cName] && duration >= 0 && duration < 1200) {
                 activeLedger.actors[cName].turnTimes.push(duration);
                 activeLedger.masterLog.push({
                     isTurnSummary: true, source: cName, duration: duration, round: activeLedger.currentTurnRound || combat.round, type: "Time"
                 });
             }
        }
        await window.CombatParser.saveArchive(); 
    }
    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "exploration";
        window.combatForensicsInstance.render(true);
    }
});

Hooks.on('renderCombatTracker', (app, html) => {
    const element = html.length ? html[0] : html;
    const header = element.querySelector('.combat-tracker-header');
    if (!header || element.querySelector('.combat-parser-container')) return;

    const btnContainer = document.createElement('div');
    btnContainer.className = "flexrow combat-parser-container";
    btnContainer.style.cssText = "margin: 5px 8px; padding-bottom: 5px; border-bottom: 1px solid var(--color-border-dark-1); display: flex; gap: 5px;";
    
    const btn = document.createElement('button');
    btn.className = "combat-forensics-btn";
    btn.style.cssText = "flex: 1; background: rgba(0, 0, 0, 0.5); border: 1px solid #ffaa00; color: #eee; text-shadow: 0 0 5px #000;";
    btn.innerHTML = '<i class="fas fa-microscope"></i> Combat Forensics';
    btn.addEventListener('click', () => {
        if (!window.combatForensicsInstance) window.combatForensicsInstance = new window.CombatForensicsApp();
        window.combatForensicsInstance.render({force: true});
    });
    btnContainer.appendChild(btn);
    header.after(btnContainer);
});