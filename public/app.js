// app.js (complete fixed version)
(() => {
    const qs = (sel) => document.querySelector(sel);
    const el = {
      userBox: qs('#userBox'),
      accountView: qs('#accountView'),
      charactersView: qs('#charactersView'),
      characterSheetView: qs('#characterSheetView'),
      inventoryView: qs('#inventoryView'),
      shopView: qs('#shopView'),
      craftingView: qs('#craftingView'),
      conditionsView: qs('#conditionsView'),
      loginForm: qs('#loginForm'),
      logoutBtn: qs('#logoutBtn'),
      charactersList: qs('#charactersList'),
      createWrap: qs('#createWrap'),
      createForm: qs('#createForm'),
      backToChars: qs('#backToChars'),
      characterForm: qs('#characterForm'),
      openInventory: qs('#openInventory'),
      openShop: qs('#openShop'),
      openEquipment: qs('#openEquipment'),
      openCrafting: qs('#openCrafting'),
      openConditions: qs('#openConditions'),
      openAssist: qs('#openAssist'),
      assistView: qs('#assistView'),
      assistContent: qs('#assistContent'),
      backToSheetFromAssist: qs('#backToSheetFromAssist'),
      backToCharsFromAssist: qs('#backToCharsFromAssist'),
      diceFeed: qs('#diceFeed'),
      damageFeed: qs('#damageFeed'),
      dmTools: qs('#dmTools'),
      shopManage: qs('#shopManage'),
      invContent: qs('#inventoryContent'),
      backToSheetFromInv: qs('#backToSheetFromInv'),
      backToCharsFromInv: qs('#backToCharsFromInv'),
      equipmentView: qs('#equipmentView'),
      equipmentContent: qs('#equipmentContent'),
      backToSheetFromEquip: qs('#backToSheetFromEquip'),
      backToCharsFromEquip: qs('#backToCharsFromEquip'),
      shopContent: qs('#shopContent'),
      backToSheetFromShop: qs('#backToSheetFromShop'),
      backToCharsFromShop: qs('#backToCharsFromShop'),
      shopManageView: qs('#shopManageView'),
      shopManagePage: qs('#shopManagePage'),
      backToCharsFromShopManage: qs('#backToCharsFromShopManage'),
      craftContent: qs('#craftingContent'),
      craftSearch: qs('#craftSearch'),
      backToSheetFromCraft: qs('#backToSheetFromCraft'),
      backToCharsFromCraft: qs('#backToCharsFromCraft'),
      conditionsContent: qs('#conditionsContent'),
      backToSheetFromCond: qs('#backToSheetFromCond'),
      backToCharsFromCond: qs('#backToCharsFromCond'),
      hamburger: qs('#hamburger'),
      searchOverlay: qs('#searchOverlay'),
      searchInput: qs('#searchInput'),
      searchResults: qs('#searchResults'),
      searchClose: qs('#searchClose'),
      perkPicker: qs('#perkPicker'),
      perkPickerGrid: qs('#perkPickerGrid'),
      perkPickerClose: qs('#perkPickerClose'),
      traitPicker: qs('#traitPicker'),
      traitPickerGrid: qs('#traitPickerGrid'),
      traitPickerClose: qs('#traitPickerClose'),
      customBgOverlay: qs('#customBgOverlay'),
      cbgSkills: qs('#cbgSkills'),
      cbgSkillsHint: qs('#cbgSkillsHint'),
      cbgItemsGrid: qs('#cbgItemsGrid'),
      cbgChosen: qs('#cbgChosen'),
      cbgItemSearch: qs('#cbgItemSearch'),
      customBgClose: qs('#customBgClose'),
      cbgApply: qs('#cbgApply')
    };
  
    let socket = null;
    let me = null; // { userId, name, role }
    let state = {
      characters: [],
      selectedCharacterId: null,
      rules: null,
      shopItems: []
    };
  
    function show(view) {
      const views = [el.accountView, el.charactersView, el.characterSheetView, el.inventoryView, el.equipmentView, el.shopView, el.shopManageView, el.craftingView, el.conditionsView, el.assistView];
        views.forEach(v => v.classList.add('hidden'));
        view.classList.remove('hidden');
      }
  
    function setUserBox() {
      el.userBox.textContent = me ? `${me.name} (${me.role})` : 'Not logged in';
    }
  
    async function api(path, opts = {}) {
      const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
  
    function connectSocket() {
      socket = io({ withCredentials: true });
  
      socket.on('connect_error', (err) => {
        console.error('socket error', err);
      });
  
      socket.on('characters:list', ({ characters }) => {
        state.characters = characters;
        renderCharacters();
        if (state.selectedCharacterId) renderCharacterSheet(state.selectedCharacterId);
      });
  
      socket.on('character:update', ({ character }) => {
        const idx = state.characters.findIndex(c => c.id === character.id);
        const prev = idx >= 0 ? state.characters[idx] : null;
        if (idx >= 0) state.characters[idx] = character; else state.characters.push(character);
        // Damage/heal feed
        if (prev && typeof prev.hp === 'number' && typeof character.hp === 'number' && character.hp !== prev.hp) {
          const delta = character.hp - prev.hp;
          const line = document.createElement('div');
          const sign = delta > 0 ? '+' : '';
        line.innerHTML = `<span class=\"pill\">HP</span> ${character.name} <b>${sign}${delta}</b> → ${character.hp}/${character.maxHp}`;
        if (el.damageFeed) {
          const anim = document.createElement('div'); anim.className='dmg-float'; anim.textContent = `${sign}${delta}`;
          el.damageFeed.prepend(anim);
          setTimeout(()=> anim.remove(), 900);
          el.damageFeed.prepend(line);
        }
        }
        renderCharacters();
      if (state.selectedCharacterId === character.id) {
        // Update local selected copy and re-render without navigating away
        renderCharacterSheet(character.id);
      }
      });
  
      socket.on('shop:update', ({ items }) => {
        state.shopItems = items;
      if (me.role === 'dm') { renderShopManage(); if (!el.shopManageView.classList.contains('hidden')) renderShopManagePage(); }
      });
  
    socket.on('dice:rolled', (d) => {
      const container = document.createElement('div');
      container.className = 'dice-roll-anim';
      
      // Create multiple dice for expression rolls
      let diceCount = 1;
      if (d && d.expr) {
        const match = d.expr.match(/(\d+)d/);
        diceCount = Math.min(match ? parseInt(match[1], 10) : 1, 6);
      }
      const diceContainer = document.createElement('div');
      diceContainer.className = 'dice-container';
      diceContainer.style.display = 'flex';
      diceContainer.style.gap = '8px';
      diceContainer.style.justifyContent = 'center';
      diceContainer.style.marginBottom = '8px';
      
      for (let i = 0; i < diceCount; i++) {
        const face = document.createElement('div');
        const sides = Number(d?.sides|| (d?.expr? 20 : 6));
        let cls = 'dice-face';
        if ([4,6,8,10,12,20].includes(sides)) cls += ` d${sides}`;
        face.className = cls; 
        face.textContent = '?';
        face.style.animationDelay = `${i * 0.1}s`;
        diceContainer.appendChild(face);
      }
      
      container.appendChild(diceContainer);
      el.diceFeed.prepend(container);
      
      // Add rolling trail effect
      const trail = document.createElement('div');
      trail.className = 'dice-trail';
      trail.innerHTML = '🎲'.repeat(diceCount);
      container.appendChild(trail);
      
      setTimeout(()=>{
        // Remove trail
        trail.remove();
        
        if (d && d.expr) {
          // Update all dice faces with individual results
          const results = d.rolls || [d.total];
          diceContainer.querySelectorAll('.dice-face').forEach((face, i) => {
            face.textContent = String(results[i] || d.total);
            face.style.animation = 'none';
            face.style.transform = 'scale(1.1)';
            setTimeout(() => face.style.transform = 'scale(1)', 200);
          });
          
          const line = document.createElement('div');
          const critText = d.total === 20 && sides === 20 ? ' 🎯 CRITICAL!' : d.total === 1 && sides === 20 ? ' 💀 CRITICAL FAIL!' : '';
          const modeText = d.mode === 'adv' ? '🎯 Advantage' : d.mode === 'dis' ? '⚠️ Disadvantage' : '🎲 Normal';
          line.innerHTML = `<span class=\"pill\">${d.expr}</span> ${modeText} • <b>${d.total}</b> <span class=\"muted\">by ${d.by}</span>${critText}${d.note ? ` <span class=\"warn\">${d.note}</span>` : ''}`;
          el.diceFeed.prepend(line);
          
          // Enhanced confetti on crit
          if (d.total === 20 && sides === 20) {
            for (let i = 0; i < 12; i++) {
              const confetti = document.createElement('div');
              confetti.className = 'confetti';
              confetti.style.left = Math.random() * 100 + '%';
              confetti.style.top = Math.random() * 100 + '%';
              confetti.style.animationDelay = Math.random() * 0.5 + 's';
              container.appendChild(confetti);
              setTimeout(() => confetti.remove(), 1500);
            }
          }
        } else {
          // Single die result
          const face = diceContainer.querySelector('.dice-face');
          face.textContent = String(d.result);
          face.style.animation = 'none';
          face.style.transform = 'scale(1.1)';
          setTimeout(() => face.style.transform = 'scale(1)', 200);
          
          const modeText = d.mode === 'adv' ? '🎯 Advantage' : d.mode === 'dis' ? '⚠️ Disadvantage' : '🎲 Normal';
          const critText = d.result === 20 && sides === 20 ? ' 🎯 CRITICAL!' : d.result === 1 && sides === 20 ? ' 💀 CRITICAL FAIL!' : '';
          const line = document.createElement('div');
          line.innerHTML = `<span class=\"pill\">d${d.sides}</span> ${modeText} • <b>${d.result}</b> <span class=\"muted\">by ${d.by}</span>${critText}`;
          el.diceFeed.prepend(line);
          
          // Enhanced confetti on crit
          if (d.result === 20 && sides === 20) {
            for (let i = 0; i < 12; i++) {
              const confetti = document.createElement('div');
              confetti.className = 'confetti';
              confetti.style.left = Math.random() * 100 + '%';
              confetti.style.top = Math.random() * 100 + '%';
              confetti.style.animationDelay = Math.random() * 0.5 + 's';
              container.appendChild(confetti);
              setTimeout(() => confetti.remove(), 1500);
            }
          }
        }
      }, 600);
    });

      socket.on('loot:rolled', (p) => {
        const card = document.createElement('div');
        card.className = 'item';
        const items = (p.items || []).map(x=>`<span class="pill">${x}</span>`).join(' ');
        card.innerHTML = `<h3>Loot for ${p.characterName}</h3><div class="meta">Tier ${p.tier} • Caps +${p.caps}</div><div>${items || '<span class="muted">No items</span>'}</div>`;
        el.diceFeed.prepend(card);
      });
  
      socket.emit('characters:request');
      socket.emit('shop:request');
    }
  
    function renderCharacters() {
      el.charactersList.innerHTML = '';
      const myChar = state.characters.find(c => me && c.ownerId === me.userId);
      // Show create if player without a character
      if (me.role === 'player') {
        if (!myChar) {
          el.createWrap.classList.remove('hidden');
          setupCreateForm();
        } else {
          el.createWrap.classList.add('hidden');
        }
      } else {
        el.createWrap.classList.add('hidden');
      }
  
      state.characters.forEach(c => {
        const isMine = me && c.ownerId === me.userId;
        const item = document.createElement('div');
        item.className = 'item';
        const hasStats = typeof c.hp === 'number' && typeof c.maxHp === 'number';
        const meta = hasStats ? `HP ${c.hp}/${c.maxHp} • XP ${c.xp} • Caps ${c.caps}${c.derived ? ` • Load ${c.derived.carryCurrent}/${c.derived.carryMax}` : ''}` : 'Limited info';
        const xpBar = hasStats ? (() => {
          const thresh = Math.max(50, 100 * (c.level || 1));
          const pct = Math.min(100, Math.floor(((c.xp || 0) / thresh) * 100));
          return `<div style="height:4px;background:#1f2937;border-radius:2px;overflow:hidden;margin:4px 0;"><div style="height:4px;width:${pct}%;background:#22c55e;"></div></div>`;
        })() : '';
        item.innerHTML = `
          <h3>${c.name}</h3>
        <div class="meta">Owner: ${c.ownerName || 'Unknown'} • ${meta}</div>
        ${xpBar}
          <div class="row-btns">
            ${(isMine || me.role === 'dm') ? `<button data-act="view" data-id="${c.id}">View</button>` : ''}
            ${(isMine || me.role === 'dm') ? `<button data-act="edit" data-id="${c.id}" class="secondary">Edit</button>` : ''}
            ${isMine ? `<button data-act="inventory" data-id="${c.id}" class="secondary">Inventory</button>
            <button data-act="equipment" data-id="${c.id}" class="secondary">Equipment</button>
            <button data-act="shop" data-id="${c.id}" class="secondary">Shop</button>
            <button data-act="crafting" data-id="${c.id}" class="secondary">Crafting</button>
            <button data-act="conditions" data-id="${c.id}" class="secondary">Conditions</button>` : ''}
            ${me.role === 'dm' ? `<button data-act="dmxp" data-id="${c.id}" class="secondary">+XP</button>
            <button data-act="dmdmg" data-id="${c.id}" class="secondary">DMG/Heal</button>
            <button data-act="shopgrant" data-id="${c.id}" class="secondary">${c.shopAccess ? 'Revoke Shop' : 'Grant Shop'}</button>
          <button data-act="dminventory" data-id="${c.id}" class="secondary">Inventory</button>
          <button data-act="dmcrafting" data-id="${c.id}" class="secondary">Crafting</button>` : ''}
          </div>`;
        el.charactersList.appendChild(item);
      });
  
      el.charactersList.onclick = (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-act');
        if (act === 'view') {
          state.selectedCharacterId = id;
          renderCharacterSheet(id);
        } else if (act === 'edit') {
          state.selectedCharacterId = id;
          renderCharacterSheet(id, true);
        } else if (act === 'dmxp') {
          const delta = Number(prompt('Add XP amount (+/-):', '10') || '0');
          if (Number.isFinite(delta)) socket.emit('dm:applyXp', { characterId: id, delta });
        } else if (act === 'dmdmg') {
          const dmg = Number(prompt('Damage amount (positive for damage, negative for healing):', '1') || '0');
          if (Number.isFinite(dmg)) socket.emit('dm:applyDamage', { characterId: id, damage: dmg });
        } else if (act === 'shopgrant') {
          const c = state.characters.find(x => x.id === id);
          socket.emit('dm:setShopAccess', { characterId: id, allow: !c.shopAccess });
        } else if (act === 'dmloot') {
          const tier = Number(prompt('Loot tier (1-5):', '1') || '1');
          if (Number.isFinite(tier)) socket.emit('dm:lootRoll', { characterId: id, tier });
        } else if (act === 'dmgivecaps') {
          const delta = Number(prompt('Give caps (+/-):', '10') || '0');
          if (Number.isFinite(delta)) socket.emit('dm:giveCaps', { characterId: id, delta });
      } else if (act === 'dminventory') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openInventory(c); }
      } else if (act === 'dmcrafting') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openCrafting(c); }
      } else if (act === 'inventory') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openInventory(c); }
      } else if (act === 'equipment') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openEquipment(c); }
      } else if (act === 'shop') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openShop(c); }
      } else if (act === 'crafting') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openCrafting(c); }
      } else if (act === 'conditions') {
        const c = state.characters.find(x => x.id === id);
        if (c) { state.selectedCharacterId = id; openConditions(c); }
      }
    };

    // DM Tools and link to manage page
      if (me.role === 'dm') {
        el.dmTools.classList.remove('hidden');
        el.dmTools.innerHTML = `
          <h3>DM Dice</h3>
          <div class="row">
            <label>Die</label>
            <select id="dmDie">
              ${[4,5,6,8,10,12,14,15,16,18,20].map(n=>`<option value="${n}">d${n}</option>`).join('')}
            </select>
          </div>
          <div class="row">
            <label>Mode</label>
            <select id="dmMode">
              <option value="normal">Normal</option>
              <option value="adv">Advantage</option>
              <option value="dis">Disadvantage</option>
            </select>
          </div>
          <button id="dmRoll">Roll</button>
          <div class="row" style="margin-top:8px;">
            <label>Expression</label>
            <input id="dmExpr" placeholder="e.g., 4d6kh3+2"/>
            <div style="display:flex; gap:8px; align-items:center;">
              <label style="display:flex; gap:6px; align-items:center;"><input id="dmPublic" type="checkbox" checked/> Public</label>
              <button id="dmExprRoll">Roll Expr</button>
            </div>
          </div>
        <div class="row"><button id="openShopManagePage" class="secondary">Open Shop Management</button></div>
        `;
        el.dmTools.querySelector('#dmRoll').onclick = () => {
          const sides = Number(el.dmTools.querySelector('#dmDie').value);
          const mode = el.dmTools.querySelector('#dmMode').value;
          socket.emit('dm:rollDice', { sides, mode });
        };
        el.dmTools.querySelector('#dmExprRoll').onclick = () => {
          const expr = el.dmTools.querySelector('#dmExpr').value.trim();
          const isPublic = el.dmTools.querySelector('#dmPublic').checked;
          if (expr) socket.emit('dice:roll', { expr, isPublic });
        };
      el.dmTools.querySelector('#openShopManagePage').onclick = () => { renderShopManagePage(); show(el.shopManageView); };
        renderShopManage();
      } else {
        el.dmTools.classList.add('hidden');
        el.dmTools.innerHTML = '';
        el.shopManage.classList.add('hidden');
        el.shopManage.innerHTML = '';
      }

      // Player dice (simple)
      let playerDice = document.getElementById('playerDice');
      if (!playerDice) {
        playerDice = document.createElement('div'); playerDice.id='playerDice'; playerDice.className='dm-tools';
        playerDice.innerHTML = `
          <h3>Dice</h3>
          <div class="row"><input id="plExpr" placeholder="e.g., 1d20+5"/></div>
          <div class="row-btns"><button id="plRoll">Roll</button></div>
        `;
        el.charactersView.insertBefore(playerDice, el.charactersList);
        playerDice.querySelector('#plRoll').onclick = () => {
          const expr = playerDice.querySelector('#plExpr').value.trim();
          if (expr) socket.emit('dice:roll', { expr, isPublic: true });
        };
      }
    }
  
    function setupCreateForm() {
      // Populate races from rules
      if (state.rules && Array.isArray(state.rules.races)) {
        const raceSel = qs('#cr-race');
        raceSel.innerHTML = state.rules.races.map(r=>`<option value="${r.name}">${r.name}</option>`).join('');
      }
      // Populate backgrounds list as suggestions
      if (state.rules && Array.isArray(state.rules.backgrounds)) {
        let dl = document.getElementById('backgroundsList');
        if (!dl) {
          dl = document.createElement('datalist'); dl.id = 'backgroundsList'; document.body.appendChild(dl);
          qs('#cr-background').setAttribute('list', 'backgroundsList');
        }
        dl.innerHTML = state.rules.backgrounds.map(b=>`<option value="${b.name}">`).join('');
        // Live preview of starting equipment
        const bgInput = qs('#cr-background');
        let bgPrev = document.getElementById('bgPreview');
        if (!bgPrev) { bgPrev = document.createElement('div'); bgPrev.id='bgPreview'; bgPrev.className='muted'; qs('#createWrap').appendChild(bgPrev); }
        const updateBgPrev = () => {
          const name = bgInput.value.trim().toLowerCase();
        if (name === 'custom background') {
          bgPrev.textContent = 'Custom: pick +2 to 3 skills and add equipment.';
        } else {
          const race = (qs('#cr-race').value || '').trim();
          const bg = state.rules.backgrounds.find(x => x.name.toLowerCase() === name);
          if (!bg) { bgPrev.textContent = ''; return; }
          const se = bg.starting_equipment || {};
          const key = Object.keys(se).find(k => k.toLowerCase().includes(race.toLowerCase())) || Object.keys(se)[0];
          const arr = Array.isArray(se[key]) ? se[key] : (typeof se[key] === 'string' ? [se[key]] : []);
          bgPrev.textContent = arr.join(' • ');
        }
        };
        bgInput.oninput = updateBgPrev; qs('#cr-race').oninput = updateBgPrev; updateBgPrev();
      // Open custom background overlay
      bgInput.addEventListener('change', ()=>{
        if (bgInput.value.trim().toLowerCase() === 'custom background') openCustomBackgroundPicker();
      });
    }
    // Traits input (opens picker overlay)
    if (state.rules && (Array.isArray(state.rules.traits) || Array.isArray(state.rules.Traits))) {
      if (!Array.isArray(state.rules.traits) && Array.isArray(state.rules.Traits)) state.rules.traits = state.rules.Traits;
      let tInput = document.getElementById('cr-trait');
      if (!tInput) {
        tInput = document.createElement('input'); tInput.id='cr-trait'; tInput.placeholder='Click to pick a trait…';
          const row = document.createElement('div'); row.className='row'; row.style.gridColumn='1/-1';
          row.innerHTML = '<label>Trait</label>';
        row.appendChild(tInput);
          qs('#createForm').appendChild(row);
        }
      tInput.readOnly = true;
      tInput.onclick = () => openTraitPicker();
    }
    // Perks input (opens picker overlay)
    if (state.rules && (Array.isArray(state.rules.perks) || Array.isArray(state.rules.Perks) || Array.isArray(state.rules?.perks?.perks))) {
      if (!Array.isArray(state.rules.perks)) {
        if (Array.isArray(state.rules.Perks)) state.rules.perks = state.rules.Perks; else if (Array.isArray(state.rules?.perks?.perks)) state.rules.perks = state.rules.perks.perks;
      }
      const input = qs('#cr-perks');
      if (input) {
        input.readOnly = true;
        input.placeholder = 'Click to pick perks…';
        input.onclick = () => openPerkPicker();
      }
      }
      const calc = () => {
        const E = Number(qs('#cr-E').value || 1);
        const A = Number(qs('#cr-A').value || 1);
        const derived = state.rules?.special?.derived || {};
        const maxHp = safeEvalFormula(derived.maxHpFormula || '10 + (E - 5)', { S: num('#cr-S'), P: num('#cr-P'), E, C: num('#cr-C'), I: num('#cr-I'), A, L: num('#cr-L') });
        qs('#cr-hp').textContent = String(maxHp);
        // Optionally show SP/AP if present
        let dv = document.getElementById('cr-derived');
        if (dv) {
          const ap = safeEvalFormula(derived.apFormula || '10 + (A - 5)', { S: num('#cr-S'), P: num('#cr-P'), E, C: num('#cr-C'), I: num('#cr-I'), A, L: num('#cr-L') });
          const sp = safeEvalFormula(derived.spFormula || '10 + (A - 5)', { S: num('#cr-S'), P: num('#cr-P'), E, C: num('#cr-C'), I: num('#cr-I'), A, L: num('#cr-L') });
          dv.innerHTML = `Max HP: <span id="cr-hp">${maxHp}</span> • AP: ${ap} • SP: ${sp}`;
        }
      // Show SPECIAL budget usage
      if (state.rules?.special) {
        const min = state.rules.special.min ?? 1;
        const max = state.rules.special.max ?? 10;
        const budget = state.rules.special.pointBudget ?? 28;
        const vals = ['#cr-S','#cr-P','#cr-E','#cr-C','#cr-I','#cr-A','#cr-L'].map(sel=>Number(qs(sel).value||0));
        const valid = vals.every(v => v >= min && v <= max);
        const sum = vals.reduce((a,b)=>a+b,0);
        let bEl = document.getElementById('cr-budget');
        if (!bEl) { bEl = document.createElement('div'); bEl.id='cr-budget'; bEl.className='muted'; qs('#createWrap').appendChild(bEl); }
        bEl.textContent = `SPECIAL budget: ${sum}/${budget}`;
        bEl.style.color = (valid && sum <= budget) ? 'var(--muted)' : '#fca5a5';
      }
        // Show skill previews if available
        if (Array.isArray(state.rules?.skills)) {
          const out = state.rules.skills.map(sk => {
            const val = safeEvalFormula(sk.baseFormula || '0', { S: num('#cr-S'), P: num('#cr-P'), E, C: num('#cr-C'), I: num('#cr-I'), A: num('#cr-A'), L: num('#cr-L') });
            return `${sk.name}: ${val}`;
          }).join(' \u2022 ');
          let pv = document.getElementById('skillPreview');
          if (!pv) { pv = document.createElement('div'); pv.id='skillPreview'; pv.className='muted'; qs('#createWrap').appendChild(pv); }
          pv.textContent = out;
        }
      };
      ['#cr-E','#cr-S','#cr-P','#cr-C','#cr-I','#cr-A','#cr-L'].forEach(id => {
        const n = qs(id); if (n) n.oninput = calc;
      });
      calc();
      el.createForm.onsubmit = async (e) => {
        e.preventDefault();
        const doc = {
          name: qs('#cr-name').value.trim(),
          race: qs('#cr-race').value,
          background: qs('#cr-background').value.trim(),
          special: {
            S: Number(qs('#cr-S').value), P: Number(qs('#cr-P').value), E: Number(qs('#cr-E').value), C: Number(qs('#cr-C').value), I: Number(qs('#cr-I').value), A: Number(qs('#cr-A').value), L: Number(qs('#cr-L').value)
          },
          perks: (qs('#cr-perks').value || '').split(',').map(s=>s.trim()).filter(Boolean),
          trait: (document.getElementById('cr-trait')?.value || '').trim()
        };
      // Attach custom background data if used
      if (String(doc.background).toLowerCase() === 'custom background' && window.__customBg) {
        doc.customBackground = { equipment: window.__customBg.equipment || [], skillBonuses: window.__customBg.skillBonuses || {} };
      }
        // Enforce SPECIAL point budget
        if (state.rules?.special) {
          const min = state.rules.special.min ?? 1;
          const max = state.rules.special.max ?? 10;
          const budget = state.rules.special.pointBudget ?? 28;
          const vals = Object.values(doc.special);
          if (vals.some(v => v < min || v > max)) { alert('SPECIAL out of allowed range'); return; }
          const sum = vals.reduce((a,b)=>a+b,0);
          if (sum > budget) { alert('SPECIAL exceeds point budget'); return; }
        }
        try {
          const res = await fetch('/api/character', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
          if (!res.ok) { alert(await res.text()); return; }
          // server emits character:update; refresh list requested for safety
          socket.emit('characters:request');
        } catch (e) { alert('Failed to create'); }
      };
    }

  function openCustomBackgroundPicker(){
    if (!el.customBgOverlay) return;
    el.customBgOverlay.classList.remove('hidden');
    window.__customBg = window.__customBg || { equipment: [], skillBonuses: {} };
    // Skills: render checkboxes allowing up to 3
    const cont = document.getElementById('cbgSkills');
    const hint = document.getElementById('cbgSkillsHint');
    cont.innerHTML = '';
    const chosen = new Set(Object.keys(window.__customBg.skillBonuses||{}));
    (state.rules?.skills||[]).forEach(sk => {
      const d = document.createElement('div'); d.className='item';
      const id = `cbg-${sk.name.replace(/\s+/g,'-').toLowerCase()}`;
      d.innerHTML = `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="${id}" ${chosen.has(sk.name)?'checked':''}/> ${sk.name}</label>`;
      cont.appendChild(d);
    });
    function refreshSkills(){
      const checked = Array.from(cont.querySelectorAll('input[type="checkbox"]:checked')).map(i=>i.parentElement.textContent.trim());
      if (checked.length > 3) { alert('Pick up to three skills'); return; }
      window.__customBg.skillBonuses = {}; checked.forEach(n=> window.__customBg.skillBonuses[n] = 2);
      hint.textContent = `Chosen ${checked.length}/3`;
    }
    cont.onchange = refreshSkills; refreshSkills();
    // Items: search and add
    const grid = document.getElementById('cbgItemsGrid');
    const chosenDiv = document.getElementById('cbgChosen');
    const input = document.getElementById('cbgItemSearch');
    function allItems(){ const out=[]; const doc=state.rules?.items||{}; (function take(val){ if(Array.isArray(val)){ for(const it of val){ if(it&&it.name) out.push(it);} } else if(val&&typeof val==='object'){ for(const v of Object.values(val)) take(v);} })(doc); return out; }
    const items = allItems();
    function renderItems(){
      grid.innerHTML = '';
      const want = String(input.value||'').toLowerCase();
      const list = document.createElement('div'); list.className='list';
      items.filter(it=> !want || String(it.name).toLowerCase().includes(want)).slice(0,120).forEach(it => {
        const d = document.createElement('div'); d.className='item';
        d.innerHTML = `<h3>${it.name}</h3>${it.description?`<div class="muted">${it.description}</div>`:''}<div class="row-btns"><button data-add="${it.name}">Add</button></div>`;
        list.appendChild(d);
      });
      grid.appendChild(list);
    }
    function renderChosen(){
      chosenDiv.innerHTML = '';
      const list = document.createElement('div'); list.className='list';
      (window.__customBg.equipment||[]).forEach((n,i)=>{ const d=document.createElement('div'); d.className='item'; d.innerHTML = `<h3>${n}</h3><div class="row-btns"><button data-rem="${i}" class="secondary">Remove</button></div>`; list.appendChild(d); });
      chosenDiv.appendChild(list);
    }
    renderItems(); renderChosen();
    input.oninput = renderItems;
    grid.onclick = (e) => { const b=e.target.closest('button[data-add]'); if(!b) return; const name=b.getAttribute('data-add'); window.__customBg.equipment = window.__customBg.equipment||[]; window.__customBg.equipment.push(name); renderChosen(); };
    chosenDiv.onclick = (e) => { const b=e.target.closest('button[data-rem]'); if(!b) return; const idx=Number(b.getAttribute('data-rem')); window.__customBg.equipment.splice(idx,1); renderChosen(); };
    // Close/apply
    const closeBtn = document.getElementById('customBgClose'); if (closeBtn) closeBtn.onclick = () => el.customBgOverlay.classList.add('hidden');
    const applyBtn = document.getElementById('cbgApply'); if (applyBtn) applyBtn.onclick = () => { el.customBgOverlay.classList.add('hidden'); };
    el.customBgOverlay.addEventListener('click', (e)=>{ if(e.target===el.customBgOverlay) el.customBgOverlay.classList.add('hidden'); });
  }
  
    function renderShopManage() {
      if (me.role !== 'dm') return;
      el.shopManage.classList.remove('hidden');
      const items = state.shopItems || [];
    // Build rules item index by category (exclude property buckets)
    const rulesItems = [];
    (function(){ 
      const doc = state.rules?.items||{}; 
      function take(val, cat){ 
        if(Array.isArray(val)){ 
          for(const it of val){ 
            if(it&&it.name) {
              const desc = it.description || it.Description || it.effect || it.Effect || '';
              const cost = it.cost || it.Cost || 0;
              rulesItems.push({ 
                category: cat, 
                name: it.name, 
                desc: desc,
                cost: cost,
                obj: it
              }); 
            } 
          } 
        } else if(val && typeof val==='object'){ 
          for (const [k,v] of Object.entries(val)){ 
            if (/^(Properties|Criticals|Ranges|Tags)$/i.test(k)) continue; 
            take(v, cat? `${cat} / ${k}` : k); 
          } 
        } 
      } 
      for (const [k,v] of Object.entries(doc)){ 
        if (/^(Properties|Criticals|Ranges|Tags)$/i.test(k)) continue; 
        take(v, k); 
      } 
    })();
    const categories = Array.from(new Set(rulesItems.map(r=>r.category))).sort();
      el.shopManage.innerHTML = `
        <h3>Shop Management</h3>
        <div class="grid-2" style="margin-bottom:8px;">
        <div class="row"><label>Category</label><select id="sm-cat">${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
        <div class="row"><label>Pick Item</label><select id="sm-item"></select></div>
          <div class="row"><label>Name</label><input id="sm-name"/></div>
          <div class="row"><label>Cost</label><input id="sm-cost" type="number" min="0"/></div>
          <div class="row"><label>Stock</label><input id="sm-stock" type="number" min="0"/></div>
          <div class="row" style="grid-column:1/-1;"><label>Description</label><input id="sm-desc"/></div>
          <button id="sm-add">Add Item</button>
        </div>
        <div class="list" id="sm-list"></div>
      `;
      const list = el.shopManage.querySelector('#sm-list');
      items.forEach(it => {
        const d = document.createElement('div');
        d.className = 'item';
        d.innerHTML = `<h3>${it.name}</h3><div class="meta">Cost ${it.cost} • Stock ${it.stock}</div><div class="row-btns"><button data-edit="${it.id}" class="secondary">Edit</button><button data-del="${it.id}" class="secondary">Delete</button></div>`;
        list.appendChild(d);
      });
    const catSel = el.shopManage.querySelector('#sm-cat');
    const itemSel = el.shopManage.querySelector('#sm-item');
    function refreshItemOptions(){
      const cat = catSel.value;
      const opts = rulesItems.filter(r=>r.category===cat).sort((a,b)=>a.name.localeCompare(b.name));
      itemSel.innerHTML = opts.map(o=>`<option value="${o.name}">${o.name}</option>`).join('');
    }
    if (catSel && itemSel){
      refreshItemOptions();
      catSel.onchange = refreshItemOptions;
      itemSel.onchange = () => { 
        const v=itemSel.value; 
        const found = rulesItems.find(r=>r.name===v); 
        if (found){ 
          el.shopManage.querySelector('#sm-name').value = found.name; 
          el.shopManage.querySelector('#sm-desc').value = found.desc||''; 
          // Auto-fill cost if available
          if (found.cost) el.shopManage.querySelector('#sm-cost').value = found.cost;
        } 
      };
    }
      el.shopManage.querySelector('#sm-add').onclick = async () => {
        const name = qs('#sm-name').value.trim();
        const cost = Number(qs('#sm-cost').value);
        const stock = Number(qs('#sm-stock').value);
        const description = qs('#sm-desc').value.trim();
        const res = await fetch('/api/shop', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, cost, stock, description }) });
        if (!res.ok) alert(await res.text());
      };
      list.onclick = async (e) => {
        const del = e.target.closest('button[data-del]');
        const ed = e.target.closest('button[data-edit]');
        if (del) {
          const id = del.getAttribute('data-del');
          const res = await fetch(`/api/shop/${id}`, { method:'DELETE', credentials:'include' });
          if (!res.ok) alert(await res.text());
        } else if (ed) {
          const id = ed.getAttribute('data-edit');
          const it = (state.shopItems||[]).find(x=>x.id===id);
          const name = prompt('Name', it.name) || it.name;
          const cost = Number(prompt('Cost', String(it.cost)) || it.cost);
          const stock = Number(prompt('Stock', String(it.stock)) || it.stock);
          const description = prompt('Description', it.description || '') || (it.description||'');
          const res = await fetch(`/api/shop/${id}`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, cost, stock, description }) });
          if (!res.ok) alert(await res.text());
        }
      };
    }

  function renderShopManagePage() {
    if (me.role !== 'dm') return;
    const host = el.shopManagePage; if (!host) return;
    host.innerHTML = '';
    const rulesItems = [];
    (function(){ const doc = state.rules?.items||{}; function take(val, cat){ if(Array.isArray(val)){ for(const it of val){ if(it&&it.name) rulesItems.push({ category: cat, name: it.name, desc: it.description||'', cost: it.cost||0 }); } } else if(val && typeof val==='object'){ for(const [k,v] of Object.entries(val)){ if (/^(Properties|Criticals|Ranges|Tags)$/i.test(k)) continue; take(v, cat? `${cat} / ${k}` : k); } } } for (const [k,v] of Object.entries(doc)){ if (/^(Properties|Criticals|Ranges|Tags)$/i.test(k)) continue; take(v, k); } })();
    const categories = Array.from(new Set(rulesItems.map(r=>r.category))).sort();
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="grid-2" style="margin-bottom:8px;">
        <div class="row"><label>Category</label><select id="smp-cat">${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
        <div class="row"><label>Pick Item</label><select id="smp-item"></select></div>
        <div class="row"><label>Name</label><input id="smp-name"/></div>
        <div class="row"><label>Cost</label><input id="smp-cost" type="number" min="0"/></div>
        <div class="row"><label>Stock</label><input id="smp-stock" type="number" min="0"/></div>
        <div class="row" style="grid-column:1/-1;"><label>Description</label><input id="smp-desc"/></div>
        <button id="smp-add">Add Item</button>
      </div>
      <div class="list" id="smp-list"></div>
    `;
    host.appendChild(wrap);
    const catSel = wrap.querySelector('#smp-cat');
    const itemSel = wrap.querySelector('#smp-item');
    const list = wrap.querySelector('#smp-list');
    const refreshItems = () => {
      list.innerHTML = '';
      (state.shopItems||[]).forEach(it => {
        const d = document.createElement('div'); d.className='item';
        d.innerHTML = `<h3>${it.name}</h3><div class="meta">Cost ${it.cost} • Stock ${it.stock}</div><div class="row-btns"><button data-edit="${it.id}" class="secondary">Edit</button><button data-del="${it.id}" class="secondary">Delete</button></div>`;
        list.appendChild(d);
      });
    };
    const refreshItemOptions = () => {
      const opts = rulesItems.filter(r=>r.category===catSel.value).sort((a,b)=>a.name.localeCompare(b.name));
      itemSel.innerHTML = opts.map(o=>`<option value="${o.name}">${o.name}</option>`).join('');
      const first = opts[0]; if (first){ wrap.querySelector('#smp-name').value = first.name; wrap.querySelector('#smp-desc').value = first.desc||''; wrap.querySelector('#smp-cost').value = first.cost||0; }
    };
    catSel.onchange = refreshItemOptions; refreshItemOptions();
    itemSel.onchange = () => { 
      const v=itemSel.value; 
      const found = rulesItems.find(r=>r.name===v && r.category===catSel.value); 
      if(found){ 
        wrap.querySelector('#smp-name').value = found.name; 
        wrap.querySelector('#smp-desc').value = found.desc||''; 
        wrap.querySelector('#smp-cost').value = found.cost||0; 
      } 
    };
    wrap.querySelector('#smp-add').onclick = async () => {
      const name = wrap.querySelector('#smp-name').value.trim();
      const cost = Number(wrap.querySelector('#smp-cost').value);
      const stock = Number(wrap.querySelector('#smp-stock').value);
      const description = wrap.querySelector('#smp-desc').value.trim();
      const res = await fetch('/api/shop', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, cost, stock, description }) });
      if (!res.ok) alert(await res.text());
    };
    wrap.onclick = async (e) => {
      const del = e.target.closest('button[data-del]');
      const ed = e.target.closest('button[data-edit]');
      if (del) {
        const id = del.getAttribute('data-del');
        const res = await fetch(`/api/shop/${id}`, { method:'DELETE', credentials:'include' });
        if (!res.ok) alert(await res.text());
      } else if (ed) {
        const id = ed.getAttribute('data-edit');
        const it = (state.shopItems||[]).find(x=>x.id===id);
        const name = prompt('Name', it.name) || it.name;
        const cost = Number(prompt('Cost', String(it.cost)) || it.cost);
        const stock = Number(prompt('Stock', String(it.stock)) || it.stock);
        const description = prompt('Description', it.description || '') || (it.description||'');
        const res = await fetch(`/api/shop/${id}`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, cost, stock, description }) });
        if (!res.ok) alert(await res.text());
      }
    };
    refreshItems();
    if (el.backToCharsFromShopManage) el.backToCharsFromShopManage.onclick = () => show(el.charactersView);
  }


  // Assist tools page
  function openAssist(c) {
    if (!(me.role === 'dm' || c.ownerId === me.userId)) { alert('You can only assist your own character.'); return; }
    show(el.assistView);
    el.assistContent.innerHTML = '';
    
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="grid-2">
        <div class="item">
          <h3>SPECIAL Stats</h3>
          <div class="row"><label>Strength</label><input type="number" min="1" max="10" id="assist-S" value="${c.special?.S || 5}"/></div>
          <div class="row"><label>Perception</label><input type="number" min="1" max="10" id="assist-P" value="${c.special?.P || 5}"/></div>
          <div class="row"><label>Endurance</label><input type="number" min="1" max="10" id="assist-E" value="${c.special?.E || 5}"/></div>
          <div class="row"><label>Charisma</label><input type="number" min="1" max="10" id="assist-C" value="${c.special?.C || 5}"/></div>
          <div class="row"><label>Intelligence</label><input type="number" min="1" max="10" id="assist-I" value="${c.special?.I || 5}"/></div>
          <div class="row"><label>Agility</label><input type="number" min="1" max="10" id="assist-A" value="${c.special?.A || 5}"/></div>
          <div class="row"><label>Luck</label><input type="number" min="1" max="10" id="assist-L" value="${c.special?.L || 5}"/></div>
        </div>
        <div class="item">
          <h3>Skills</h3>
          <div id="assistSkills"></div>
        </div>
      </div>
      <div class="item">
        <h3>Perks</h3>
        <div class="row-btns">
          <button id="addPerk">Add Perk</button>
          <button id="removePerk" class="secondary">Remove Perk</button>
        </div>
        <div id="currentPerks" class="list"></div>
      </div>
      <div class="row-btns">
        <button id="saveAssist">Save Changes</button>
        <button id="cancelAssist" class="secondary">Cancel</button>
      </div>
    `;
    el.assistContent.appendChild(wrap);
    
    // Skills
    const skillsDiv = wrap.querySelector('#assistSkills');
    if (Array.isArray(state.rules?.skills)) {
      const pts = c.skillsPoints || {};
      state.rules.skills.forEach(sk => {
        const row = document.createElement('div');
        row.className = 'row';
        const current = Number(pts[sk.name] || 0);
        row.innerHTML = `
          <label>${sk.name}</label>
          <input type="number" min="0" max="50" id="skill-${sk.name}" value="${current}"/>
        `;
        skillsDiv.appendChild(row);
      });
    }
    
    // Current perks
    const perksDiv = wrap.querySelector('#currentPerks');
    const currentPerks = Array.isArray(c.perks) ? c.perks : [];
    currentPerks.forEach(perk => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<h3>${perk}</h3><div class="row-btns"><button data-remove="${perk}" class="secondary">Remove</button></div>`;
      perksDiv.appendChild(item);
    });
    
    // Add perk
    wrap.querySelector('#addPerk').onclick = () => {
      const input = prompt('Enter perk name:');
      if (input && !currentPerks.includes(input)) {
        currentPerks.push(input);
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `<h3>${input}</h3><div class="row-btns"><button data-remove="${input}" class="secondary">Remove</button></div>`;
        perksDiv.appendChild(item);
      }
    };
    
    // Remove perk
    perksDiv.onclick = (e) => {
      const btn = e.target.closest('button[data-remove]');
      if (!btn) return;
      const perk = btn.getAttribute('data-remove');
      const idx = currentPerks.indexOf(perk);
      if (idx > -1) {
        currentPerks.splice(idx, 1);
        btn.closest('.item').remove();
      }
    };
    
    // Save
    wrap.querySelector('#saveAssist').onclick = () => {
      const special = {};
      ['S','P','E','C','I','A','L'].forEach(stat => {
        special[stat] = Number(wrap.querySelector(`#assist-${stat}`).value || 5);
      });
      
      const skillsPoints = {};
      if (Array.isArray(state.rules?.skills)) {
        state.rules.skills.forEach(sk => {
          const val = Number(wrap.querySelector(`#skill-${sk.name}`).value || 0);
          if (val > 0) skillsPoints[sk.name] = val;
        });
      }
      
      socket.emit('character:update', { 
        id: c.id, 
        updates: { 
          special, 
          skillsPoints, 
          perks: currentPerks 
        } 
      });
      show(el.characterSheetView);
    };
    
    wrap.querySelector('#cancelAssist').onclick = () => show(el.characterSheetView);
    if (el.backToSheetFromAssist) el.backToSheetFromAssist.onclick = () => show(el.characterSheetView);
  }
  
    function num(sel){ return Number(qs(sel).value || 0); }
    function safeEvalFormula(formula, ctx) {
      // Very limited evaluator for formulas using S,P,E,C,I,A,L and basic math
      const allowed = { ...ctx, floor: Math.floor, ceil: Math.ceil, max: Math.max, min: Math.min, abs: Math.abs };
      const keys = Object.keys(allowed);
      const vals = Object.values(allowed);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(...keys, `return (${formula});`);
        const res = fn(...vals);
        return Number.isFinite(res) ? res : 0;
      } catch { return 0; }
    }
  
    function renderCharacterSheet(id, forceEdit = false) {
      const c = state.characters.find(x => x.id === id);
      if (!c) return;
      const canEdit = me.role === 'dm' || c.ownerId === me.userId || forceEdit === true;
      show(el.characterSheetView);
      el.characterForm.innerHTML = '';
  
      const fields = [
        ['name', 'Name', 'text'],
        ['xp', 'XP', 'number'],
        ['hp', 'HP', 'number'],
        ['maxHp', 'Max HP', 'number'],
        ['caps', 'Caps', 'number']
      ];
      fields.forEach(([key, label, type]) => {
        const wrap = document.createElement('div');
        wrap.className = 'row';
        const inputId = `f-${key}`;
        wrap.innerHTML = `
          <label for="${inputId}">${label}</label>
          <input id="${inputId}" type="${type}" ${canEdit ? '' : 'disabled'} value="${c[key]}" />
        `;
        el.characterForm.appendChild(wrap);
      });
  
    // SPECIAL persistent feed as bubbly pills
      const specialFeed = document.createElement('div');
      specialFeed.className = 'row';
    const sp = c.special || {};
    const letters = ['S','P','E','C','I','A','L'];
    const pills = letters.map(k=>`<span class=\"pill big\">${k}:<b>${sp[k]||1}</b></span>`).join(' ');
    specialFeed.innerHTML = `<label>S.P.E.C.I.A.L.</label><div>${pills}</div>`;
      el.characterForm.appendChild(specialFeed);

    // Derived stats as pills (include weapons summary if equipped)
    const d = c.derived || {};
    const derWrap = document.createElement('div');
    derWrap.className = 'row';
    const weapon = (c.equipment||{})['Weapon 1'] || '';
    derWrap.innerHTML = `<label>Derived</label><div style=\"display:flex;gap:6px;flex-wrap:wrap;\">`+
      `<span class=\"pill secondary\">AP:<b>${d.ap ?? '—'}</b></span>`+
      `<span class=\"pill secondary\">SP:<b>${d.sp ?? '—'}</b></span>`+
      `<span class=\"pill secondary\">AC:<b>${d.ac ?? '—'}</b></span>`+
      `<span class=\"pill secondary\">DT:<b>${d.dt ?? '—'}</b></span>`+
      `<span class=\"pill secondary\">Load:<b>${d.carryCurrent ?? 0}/${d.carryMax ?? 0}</b></span>`+
      (weapon? ` <span class=\"pill\">Weapon:<b>${weapon}</b></span>` : '')+
    `</div>`;
    el.characterForm.appendChild(derWrap);

    // Skills to right pane
      if (Array.isArray(state.rules?.skills)) {
        const skillsWrap = document.createElement('div');
      const pane = document.getElementById('skillsPane');
      pane.innerHTML = '';
        const pts = c.skillsPoints || {};
        const remaining = Math.max(0, Number(c.unspentSkillPoints||0));
      const items = state.rules.skills.map(sk => {
          const base = safeEvalFormula(sk.baseFormula || '0', { S: c.special?.S||1, P: c.special?.P||1, E: c.special?.E||1, C: c.special?.C||1, I: c.special?.I||1, A: c.special?.A||1, L: c.special?.L||1 });
          const extra = Number(pts[sk.name] || 0);
          const total = base + extra;
          if (canEdit) {
            const disabled = remaining <= 0 ? 'disabled' : '';
          return `<div class=\"item\"><div><b>${sk.name}</b></div><div class=\"meta\">Base ${base} • Spent ${extra}</div><div class=\"row-btns\"><button type=\"button\" data-skill-add=\"${sk.name}\" ${disabled}>+1</button></div><div class=\"meta\">Total <b>${total}</b></div></div>`;
          } else {
          return `<div class=\"item\"><div><b>${sk.name}</b></div><div class=\"meta\">Total <b>${total}</b></div></div>`;
          }
        }).join('');
      const head = canEdit ? `<div class=\"muted\">Skills — Unspent Points: ${remaining}</div>` : '<div class=\"muted\">Skills</div>';
      skillsWrap.innerHTML = `${head}<div class=\"skills-grid\">${items}</div>`;
      pane.appendChild(skillsWrap);
        if (canEdit) {
        pane.onclick = (e) => {
          e.preventDefault();
            const b = e.target.closest('button[data-skill-add]');
            if (!b) return;
            if (remaining <= 0) { alert('No unspent skill points'); return; }
            const name = b.getAttribute('data-skill-add');
            const cur = Number((c.skillsPoints||{})[name] || 0);
            const skillsPoints = { ...(c.skillsPoints||{}) };
            skillsPoints[name] = cur + 1;
            socket.emit('character:update', { id: c.id, updates: { skillsPoints } });
          };
        }
      }

    // Show current conditions on sheet
    const condsRow = document.createElement('div');
    condsRow.className = 'row';
    const conds = Array.isArray(c.conditions) ? c.conditions : [];
    condsRow.innerHTML = `<label>Conditions</label><div>${conds.length? conds.map(x=>`<span class=\"pill\">${x}</span>`).join(' '):'<span class=\"muted\">None</span>'}</div>`;
    el.characterForm.appendChild(condsRow);

    // Equipment summary moved to right pane under skills
      const equipWrap = document.createElement('div');
    equipWrap.className = 'equipment-summary';
    const equipped2 = c.equipment || {};
    const armorVal2 = equipped2['Armor'] || equipped2['armor'] || '';
    const curUpgs2 = (() => {
      const raw = c.equipmentUpgrades || {};
      if (Object.values(raw).some(v => typeof v === 'object' && !Array.isArray(v))) {
        const merged = {}; Object.values(raw).forEach(m => { for (const [k,v] of Object.entries(m)) merged[k]=v; }); return merged;
      }
      return raw;
    })();
    const upgLines2 = Object.entries(curUpgs2).map(([n,r])=>`<span class="pill">${n} (Rank ${r})</span>`).join(' ');
    const wMain = equipped2['Weapon 1'] || '';
    const wOff = equipped2['Weapon 2'] || '';
    function findRuleItemByNameSheet(n){ const doc = state.rules?.items||{}; const matches=[]; (function scan(val){ if (Array.isArray(val)) { for (const it of val){ if (it && it.name && String(it.name).toLowerCase()===String(n).toLowerCase()) matches.push(it); } } else if (val && typeof val==='object'){ for (const v of Object.values(val)) scan(v);} })(doc); return matches[0]||null; }
    function weaponSummary(name){
      if (!name) return 'None';
      const rule = findRuleItemByNameSheet(name);
      if (!rule) return name;
      const dmg = rule.damage ? ` • DMG ${rule.damage}` : '';
      const apv = (rule.ap||rule.AP) ? ` • AP ${rule.ap||rule.AP}` : '';
      const crit = (rule.critical||rule.Critical) ? ` • Crit ${rule.critical||rule.Critical}` : '';
      return `${name}${dmg}${apv}${crit}`;
    }
      equipWrap.innerHTML = `
      <h3>Equipment</h3>
      <div class="list"> 
        <div class="item"><h3>Armor</h3><div class="meta">${armorVal2 || 'None'}</div><div>${upgLines2 || '<span class="muted">No upgrades</span>'}</div><div class="row-btns"><button type="button" class="secondary" id="manageEquip">Manage</button></div></div>
        <div class="item"><h3>Weapons</h3><div class="meta">Main: ${weaponSummary(wMain)} • Off: ${weaponSummary(wOff)}</div></div>
        </div>
      `;
    // Add to skills pane instead of main form
    const skillsPane = document.getElementById('skillsPane');
    if (skillsPane) {
      skillsPane.appendChild(equipWrap);
      const manageBtn2 = equipWrap.querySelector('#manageEquip');
      if (manageBtn2) manageBtn2.onclick = () => openEquipment(c);
    }

      // Save on change for editable + XP bar
      if (canEdit) {
        el.characterForm.oninput = (e) => {
          const updates = {
            name: qs('#f-name').value,
            xp: Number(qs('#f-xp').value),
            hp: Number(qs('#f-hp').value),
            maxHp: Number(qs('#f-maxHp').value),
            caps: Number(qs('#f-caps').value)
          };
          socket.emit('character:update', { id: c.id, updates });
        };
      } else {
        el.characterForm.oninput = null;
      }

      // XP bar
      const prog = document.createElement('div');
      prog.className = 'row';
      const thresh = Math.max(50, 100 * (c.level || 1));
      const pct = Math.min(100, Math.floor(((c.xp || 0) / thresh) * 100));
    prog.innerHTML = `<label>Level ${c.level || 1} — XP ${c.xp || 0}/${thresh}</label><div style=\"height:8px;background:#1f2937;border-radius:6px;overflow:hidden;\"><div style=\"height:8px;width:${pct}%;background:#22c55e;\"></div></div>`;
    // Insert at top of sheet
    el.characterForm.prepend(prog);
  
    // // Move toolbar to top left of back button
    // const toolbar = document.createElement('div');
    // toolbar.className = 'toolbar';
    // toolbar.style.position = 'absolute';
    // toolbar.style.top = '105px';
    // toolbar.style.right = '210px';
    // toolbar.innerHTML = `
    //   <button id="openInventory">Inventory</button>
    //   <button id="openEquipment">Equipment</button>
    //   <button id="openShop">Shop</button>
    //   <button id="openCrafting" class="secondary">Crafting</button>
    //   <button id="openConditions" class="secondary">Conditions</button>
    //   <button id="openAssist" class="secondary">Assist</button>
    // `;
    // el.characterSheetView.appendChild(toolbar);
    
    // Set up toolbar button handlers
    toolbar.querySelector('#openInventory').onclick = () => openInventory(c);
    toolbar.querySelector('#openEquipment').onclick = () => openEquipment(c);
    toolbar.querySelector('#openShop').onclick = () => openShop(c);
    if (toolbar.querySelector('#openCrafting')) toolbar.querySelector('#openCrafting').onclick = () => openCrafting(c);
    if (toolbar.querySelector('#openConditions')) toolbar.querySelector('#openConditions').onclick = () => openConditions(c);
    if (toolbar.querySelector('#openAssist')) toolbar.querySelector('#openAssist').onclick = () => openAssist(c);
    }
  
    function openInventory(c) {
      // Only owner can view inventory
    if (!(me.role === 'dm' || c.ownerId === me.userId)) { alert('You can only view your own inventory.'); return; }
      show(el.inventoryView);
      el.invContent.innerHTML = '';
  
    // Helpers
    const indexItems = () => state.rules?.items || {};
    const findRuleItemByName = (name) => {
      const items = indexItems(); const matches = [];
      (function scan(val, cat){
        if (Array.isArray(val)) { for (const obj of val) { if (obj && obj.name) {
          if (String(obj.name).toLowerCase() === String(name).toLowerCase()) { matches.push({ obj, category: cat||'' }); }
        } } } else if (val && typeof val==='object') { for (const [k,v] of Object.entries(val)) scan(v, cat? `${cat} / ${k}`: k); }
      })(items,'');
      return matches[0] || null;
    };
    const sellPrice = (cost) => Math.floor(Number(cost||0) * 0.3);

    // Categorize
    const groups = { Weapons: [], Armor: [], Tools: [], Ammo: [], Consumables: [], Misc: [] };
    (c.inventory||[]).forEach(name => {
      const match = findRuleItemByName(name);
      const o = match?.obj || {}; const cat = (match?.category||'').toLowerCase();
      let key = 'Misc';
      if (/weapon|guns|melee|energy|explosive|unarmed/.test(cat) || /damage|critical/i.test(JSON.stringify(o))) key='Weapons';
      else if (/armor|shield|power armor/i.test(cat) || o.armor_class || o.damage_threshold) key = 'Armor';
      else if (/tool|kit|lockpick|repair|bandolier|rope|flashlight|binocular/i.test(cat)) key='Tools';
      else if (/ammo|bullet|cell|shell|round/i.test(cat)) key='Ammo';
      else if (/food|water|drink|chems|stimpak|radaway|rad-x|drug|syringe/i.test(cat)) key='Consumables';
      groups[key].push({ name, rule: o, category: match?.category||'' });
    });

    const renderGroup = (title, arr) => {
      if (!arr.length) return '';
      const cards = arr.map(({ name, rule, category }) => {
        const details = [];
        if (rule.damage) details.push(`Damage: ${rule.damage}`);
        if (rule.range || rule.Range) details.push(`Range: ${rule.range||rule.Range}`);
        if (rule.ap || rule.AP) details.push(`AP: ${rule.ap||rule.AP}`);
        if (rule.critical || rule.Critical) details.push(`Critical: ${rule.critical||rule.Critical}`);
        if (rule.requirements?.strength) details.push(`STR Req: ${rule.requirements.strength}`);
        if (rule.armor_class) details.push(`AC: ${rule.armor_class}`);
        if (rule.damage_threshold) details.push(`DT: ${rule.damage_threshold}`);
        if (rule.carry_load) details.push(`Load: ${typeof rule.carry_load==='object'? (rule.carry_load.full||rule.carry_load.empty||0):rule.carry_load}`);
        if (rule.cost) details.push(`Sell: ${sellPrice(rule.cost)} caps`);
        
        // Enhanced details for food/chems
        const enhancedDetails = [];
        if (rule.healing) enhancedDetails.push(`Heals: ${rule.healing} HP`);
        if (rule.stamina) enhancedDetails.push(`Stamina: ${rule.stamina} SP`);
        if (rule.radiation) enhancedDetails.push(`Radiation: ${rule.radiation}`);
        if (rule.addiction) enhancedDetails.push(`Addiction: ${rule.addiction}`);
        if (rule.duration) enhancedDetails.push(`Duration: ${rule.duration}`);
        if (rule.effects) enhancedDetails.push(`Effects: ${rule.effects}`);
        if (rule.weight) enhancedDetails.push(`Weight: ${rule.weight}`);
        if (rule.value) enhancedDetails.push(`Value: ${rule.value} caps`);
        if (rule.rarity) enhancedDetails.push(`Rarity: ${rule.rarity}`);
        if (rule.tags) enhancedDetails.push(`Tags: ${Array.isArray(rule.tags) ? rule.tags.join(', ') : rule.tags}`);
        
        const desc = rule.description || rule.Description || '';
        const buttons = [];
        if (title === 'Consumables') buttons.push(`<button data-use="${name}">Use</button>`);
        if (title === 'Weapons' || title === 'Armor') buttons.push(`<button class="secondary" data-equip="${name}">Equip</button>`);
        buttons.push(`<button class="secondary" data-drop="${name}">Drop</button>`);
        
        const allDetails = [...details, ...enhancedDetails];
        return `<div class="item"><h3>${name}</h3><div class="meta">${category}</div>${desc?`<div class="muted">${desc}</div>`:''}${allDetails.length?`<div class="meta">${allDetails.join(' • ')}</div>`:''}<div class="row-btns">${buttons.join(' ')}</div></div>`;
      }).join('');
      return `<div class="row"><h3 style="margin:0 0 6px 0;">${title}</h3><div class="list">${cards}</div></div>`;
    };

    el.invContent.innerHTML = [
      renderGroup('Weapons', groups.Weapons),
      renderGroup('Armor', groups.Armor),
      renderGroup('Tools', groups.Tools),
      renderGroup('Ammo', groups.Ammo),
      renderGroup('Consumables', groups.Consumables),
      renderGroup('Misc', groups.Misc)
    ].join('');

    // DM: Give item UI inside inventory
      if (me.role === 'dm') {
      const dmGive = document.createElement('div'); dmGive.className='row';
      dmGive.innerHTML = `<label>DM: Give Item</label><input id="dmItemSearchInv" placeholder="Search items..."/> <div id="dmItemListInv" class="list"></div>`;
      el.invContent.appendChild(dmGive);
      const host = dmGive.querySelector('#dmItemListInv');
      const all = []; (function take(val, cat){ if (Array.isArray(val)) { for (const it of val){ if (it && it.name) all.push({ name: it.name, desc: it.description||'', category: cat||'' }); } } else if (val && typeof val==='object'){ for (const [k,v] of Object.entries(val)) take(v, cat? `${cat} / ${k}` : k); } })(state.rules?.items||{}, '');
      const input = dmGive.querySelector('#dmItemSearchInv');
      const renderDmGive = ()=>{ const want=String(input.value||'').toLowerCase(); host.innerHTML=''; all.filter(it=>!want||String(it.name).toLowerCase().includes(want)).slice(0,60).forEach(it=>{ const d=document.createElement('div'); d.className='item'; d.innerHTML=`<h3>${it.name}</h3><div class=\"meta\">${it.category}</div>${it.desc?`<div class=\"muted\">${it.desc}</div>`:''}<div class=\"row-btns\"><button data-give=\"${it.name}\">Give</button></div>`; host.appendChild(d); }); };
      input.oninput = renderDmGive; renderDmGive();
      host.onclick = (e)=> { const b=e.target.closest('button[data-give]'); if(!b) return; socket.emit('dm:giveItem', { characterId: c.id, itemName: b.getAttribute('data-give') }); };
    }

    el.invContent.onclick = (e) => {
      const use = e.target.closest('button[data-use]');
      const eq = e.target.closest('button[data-equip]');
      const drop = e.target.closest('button[data-drop]');
      if (use) {
        const item = use.getAttribute('data-use');
        socket.emit('character:useItem', { id: c.id, item });
      } else if (eq) {
        const item = eq.getAttribute('data-equip');
        // Heuristic: Equip to Weapon 1 if it looks like a weapon, else ignore here (armor in Equipment page)
        socket.emit('character:equip', { id: c.id, item, slot: 'Weapon 1' });
      } else if (drop) {
        const item = drop.getAttribute('data-drop');
        socket.emit('character:drop', { id: c.id, item });
      }
    };

    el.backToSheetFromInv.onclick = () => show(el.characterSheetView);
  }

  function gatherRecipes() {
    const doc = state.rules?.crafting || {};
    const out = [];
    function take(arr, type) {
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        if (it && (it.Name || it.name) && it.Craft) out.push({ ...it, __type: type });
      }
    }
    for (const [k, v] of Object.entries(doc.CraftableItems || {})) take(v, k);
    for (const [k, v] of Object.entries(doc)) {
      if (Array.isArray(v)) take(v, k);
    }
    return out;
  }

  function openCrafting(c) {
    if (!(me.role === 'dm' || c.ownerId === me.userId)) { alert('You can only craft for your own character.'); return; }
    show(el.craftingView);
    const all = gatherRecipes();
    const categories = Array.from(new Set(all.map(r=>r.__type || 'Other'))).sort();
    el.craftContent.innerHTML = '';
    const layout = document.createElement('div'); layout.className='crafting-layout';
    const left = document.createElement('div');
    const right = document.createElement('div'); right.className='sidebar';
    right.innerHTML = `<h3>Materials</h3>` + (Object.entries(c.materials||{}).length ? Object.entries(c.materials||{}).map(([k,v])=>`<div class=\"muted\">${k}: ${v}</div>`).join('') : '<div class=\"muted\">None</div>');
    
    // DM Materials section
      if (me.role === 'dm') {
      const dmMaterials = document.createElement('div');
      dmMaterials.className = 'dm-materials';
      dmMaterials.innerHTML = `
        <h3>DM: Give Materials</h3>
        <div class="row">
          <input id="dmMatSearch" placeholder="Search materials..." style="flex:1;"/>
          <input id="dmMatAmount" type="number" min="1" value="1" style="width:80px;"/>
        </div>
        <div id="dmMatList" class="list"></div>
      `;
      right.appendChild(dmMaterials);
      
      const materials = ['cloth', 'steel', 'leather', 'adhesive', 'circuitry', 'nuclear material', 'plastic', 'glass', 'wood', 'aluminum', 'copper', 'gold', 'silver', 'oil', 'spring', 'screws', 'gears', 'crystal', 'fiber optics', 'fiberglass'];
      const searchInput = dmMaterials.querySelector('#dmMatSearch');
      const amountInput = dmMaterials.querySelector('#dmMatAmount');
      const listDiv = dmMaterials.querySelector('#dmMatList');
      
      const renderMaterials = () => {
        const want = searchInput.value.toLowerCase();
        listDiv.innerHTML = '';
        materials.filter(m => !want || m.toLowerCase().includes(want)).forEach(mat => {
          const item = document.createElement('div');
          item.className = 'item';
          item.innerHTML = `
            <h3>${mat}</h3>
            <div class="row-btns">
              <button data-give-mat="${mat}">Give</button>
              <button data-remove-mat="${mat}" class="secondary">Remove</button>
            </div>
          `;
          listDiv.appendChild(item);
        });
      };
      
      searchInput.oninput = renderMaterials;
      renderMaterials();
      
      listDiv.onclick = (e) => {
        const btn = e.target.closest('button[data-give-mat]');
        const removeBtn = e.target.closest('button[data-remove-mat]');
        if (btn) {
          const mat = btn.getAttribute('data-give-mat');
          const amt = Number(amountInput.value || 1);
          if (amt > 0) {
            fetch(`/api/characters/${c.id}/materials`, { 
              method:'POST', 
              credentials:'include', 
              headers:{'Content-Type':'application/json'}, 
              body: JSON.stringify({ add: { [mat.toLowerCase()]: amt } }) 
            });
          }
        } else if (removeBtn) {
          const mat = removeBtn.getAttribute('data-remove-mat');
          const amt = Number(amountInput.value || 1);
          if (amt > 0) {
            fetch(`/api/characters/${c.id}/materials`, { 
              method:'POST', 
              credentials:'include', 
              headers:{'Content-Type':'application/json'}, 
              body: JSON.stringify({ remove: { [mat.toLowerCase()]: amt } }) 
            });
          }
        }
      };
    }
    
    layout.appendChild(left); layout.appendChild(right);
    el.craftContent.appendChild(layout);
    const toolbar = document.createElement('div'); toolbar.className='toolbar';
    const sel = document.createElement('select'); sel.innerHTML = `<option value="all">All</option>` + categories.map(c=>`<option value="${c}">${c}</option>`).join('');
    const input = document.createElement('input'); input.placeholder='Search recipes...'; input.id='craftSearch'; input.style.flex='1';
    toolbar.appendChild(input); toolbar.appendChild(sel);
    left.appendChild(toolbar);
    const list = document.createElement('div'); list.className='two-col'; left.appendChild(list);
    const render = () => {
      const want = String(input.value||'').trim().toLowerCase();
      const cat = sel.value;
      list.innerHTML = '';
      all.filter(r => (cat==='all' || r.__type===cat) && (!want || String(r.Name||r.name).toLowerCase().includes(want))).slice(0, 300).forEach(r => {
        const matsArr = Array.isArray(r.Craft?.Materials) ? r.Craft.Materials : [];
        const matMap = (function(){ const out={}; matsArr.forEach(m=>{ const mm=String(m).match(/^x?(\d+)\s+(.+)$/i); if(mm){ out[mm[2].toLowerCase()] = (out[mm[2].toLowerCase()]||0)+Number(mm[1]); } }); return out; })();
        const canCraft = Object.entries(matMap).every(([k,v]) => Number((c.materials||{})[k]||0) >= v);
        const matsHtml = matsArr.map(x=>`<span class=\"pill\">${x}</span>`).join(' ');
        const effect = r.Description || r.Effect || r.description || r.effect || '';
        const div = document.createElement('div'); div.className='item';
        let dc = ''; let skill = 'Crafting'; const dcField = r.Craft?.DC; if (typeof dcField==='number'){ dc=String(dcField);} else if (dcField&&typeof dcField==='object'){ const first=Object.entries(dcField)[0]; if(first){ skill=first[0]; dc=String(first[1]); } }
        div.innerHTML = `<h3>${r.Name||r.name}</h3><div class=\"meta\">${r.__type||'Recipe'}${dc?` • DC ${dc}`:''}${skill?` • ${skill}`:''}</div>${effect?`<div class=\"muted\">${effect}</div>`:''}<div>${matsHtml||'<span class=\"muted\">No materials</span>'}</div><div class=\"row-btns\"><button data-craft=\"${r.Name||r.name}\" ${canCraft?'' : 'disabled'}>${canCraft? 'Craft' : 'Missing mats'}</button></div>`;
        list.appendChild(div);
      });
    };
    input.oninput = render; sel.onchange = render; render();
    list.onclick = async (e) => {
      const b = e.target.closest('button[data-craft]'); if (!b) return; if (b.hasAttribute('disabled')) return;
      const name = b.getAttribute('data-craft');
        try {
          const res = await fetch('/api/craft', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
          const data = await res.json();
        if (!res.ok || !data.ok) { alert(data.error||data.message||'Craft failed'); return; }
          socket.emit('characters:request');
        alert(`Crafted ${data.crafted}`);
        } catch { alert('Craft failed'); }
      };
    if (el.backToSheetFromCraft) el.backToSheetFromCraft.onclick = () => show(el.characterSheetView);
  }

  function openConditions(c) {
    show(el.conditionsView);
    const all = Array.isArray(state.rules?.conditions) ? state.rules.conditions : [];
    el.conditionsContent.innerHTML = '';
    const youHave = Array.isArray(c.conditions) ? c.conditions : [];
    const haveDiv = document.createElement('div');
    haveDiv.className = 'row';
    haveDiv.innerHTML = `<label>You Have</label><div>${youHave.length? youHave.map(x=>`<span class=\"pill\">${x}</span>`).join(' '):'<span class=\"muted\">None</span>'}</div>`;
    el.conditionsContent.appendChild(haveDiv);
    const list = document.createElement('div'); list.className='list';
    all.forEach(cond => {
      const d = document.createElement('div'); d.className='item';
      const effects = Array.isArray(cond.Effects) ? cond.Effects.map(e=>`<div class=\"muted\">• ${e}</div>`).join('') : '<div class=\"muted\">—</div>';
      d.innerHTML = `<h3>${cond.Name}</h3>${effects}`;
      list.appendChild(d);
    });
    el.conditionsContent.appendChild(list);
    // DM editor
    if (me.role === 'dm') {
      const editor = document.createElement('div'); editor.className='row';
      editor.innerHTML = `<label>DM: Set Conditions (comma)</label><input id=\"dmCondsInput\" value=\"${youHave.join(', ')}\"/><button id=\"dmCondsSave\">Save</button>`;
      el.conditionsContent.appendChild(editor);
      editor.querySelector('#dmCondsSave').onclick = () => {
        const raw = editor.querySelector('#dmCondsInput').value||'';
        const arr = raw.split(',').map(s=>s.trim()).filter(Boolean);
        socket.emit('dm:setConditions', { characterId: c.id, conditions: arr });
      };
    }
    if (el.backToSheetFromCond) el.backToSheetFromCond.onclick = () => show(el.characterSheetView);
  }
    function openShop(c) {
      if (!c.shopAccess) {
        alert('Shop not near');
        return;
      }
      show(el.shopView);
      el.shopContent.innerHTML = '';
      const items = state.shopItems || [];
      const list = document.createElement('div');
      list.className = 'list';
      items.forEach(g => {
        const it = document.createElement('div');
        it.className = 'item';
        it.innerHTML = `<h3>${g.name}</h3><div class="meta">Cost: ${g.cost} caps • Stock: ${g.stock}</div><div class="row-btns"><button data-buy="${g.id}">Buy</button></div>`;
        list.appendChild(it);
      });
      el.shopContent.appendChild(list);
  
      el.shopContent.onclick = (e) => {
        const btn = e.target.closest('button[data-buy]');
        if (!btn) return;
        const id = btn.getAttribute('data-buy');
        fetch(`/api/shop/${id}/buy`, { method:'POST', credentials:'include' }).then(async res => {
          if (!res.ok) alert(await res.text());
        });
      };
  
      el.backToSheetFromShop.onclick = () => show(el.characterSheetView);
    }
  
  // Equipment page
  function openEquipment(c) {
    show(el.equipmentView);
    el.equipmentContent.innerHTML = '';
    const equipped = c.equipment || {};
    const upgs = c.equipmentUpgrades || {};
    const armor = equipped['Armor'] || equipped['armor'] || '';
    const rulesUpgsAll = (state.rules?.crafting?.CraftableItems?.ArmorUpgrades || []).map(u=>({ name: u.Name || u.name, ranks: Array.isArray(u.Ranks)? u.Ranks.length : 1 }));
    const invNames = new Set((c.inventory||[]).map(x=>String(x).toLowerCase()));
    const rulesUpgs = rulesUpgsAll.filter(u=> invNames.has(String(u.name).toLowerCase()));
    const wrap = document.createElement('div'); wrap.className='grid-2';
    const armorCard = document.createElement('div'); armorCard.className='item';
    armorCard.innerHTML = `
      <h3>Armor</h3>
      <div class="row"><label>Equipped</label>
        <select id="eq-armor"><option value="">None</option></select>
      </div>
      <div class="row"><label>Upgrades</label><div id="eq-upg-list"></div>
        <div class="row-btns"><button id="eq-upg-add" type="button">Add Upgrade</button><button id="eq-upg-clear" type="button" class="secondary">Clear</button></div>
      </div>`;
    wrap.appendChild(armorCard);
    // Weapons card
    const weapCard = document.createElement('div'); weapCard.className='item';
    weapCard.innerHTML = `
      <h3>Weapons</h3>
      <div class="row"><label>Weapon 1</label><select id="eq-w1"><option value="">None</option></select></div>
      <div class="row"><label>Weapon 2</label><select id="eq-w2"><option value="">None</option></select></div>
    `;
    wrap.appendChild(weapCard);
    // Other slots card
    const otherCard = document.createElement('div'); otherCard.className='item';
    otherCard.innerHTML = `
      <h3>Other Slots</h3>
      <div class="row"><label>Helmet</label><select id="eq-helmet"><option value="">None</option></select></div>
      <div class="row"><label>Torso</label><select id="eq-torso"><option value="">None</option></select></div>
      <div class="row"><label>Legs</label><select id="eq-legs"><option value="">None</option></select></div>
    `;
    wrap.appendChild(otherCard);
    el.equipmentContent.appendChild(wrap);
    // Populate armor options from owned armor
    const ownedArmor = (state.rules?.items?.Armor || []).map(a=>a.name).filter(n => (c.inventory||[]).some(inv => String(inv).toLowerCase() === String(n).toLowerCase()));
    const armorSel = armorCard.querySelector('#eq-armor');
    armorSel.innerHTML = `<option value="">None</option>` + ownedArmor.map(n=>`<option value="${n}">${n}</option>`).join('');
    armorSel.value = armor || '';
    const upgList = armorCard.querySelector('#eq-upg-list');
    const upgAdd = armorCard.querySelector('#eq-upg-add');
    const upgClear = armorCard.querySelector('#eq-upg-clear');
    function makeRow(nm, rk){
      const row = document.createElement('div'); row.className='row';
      const nameSel = document.createElement('select'); nameSel.className='eq-upg-name';
      rulesUpgs.forEach(u=>{ const opt=document.createElement('option'); opt.value=u.name; opt.textContent=u.name; nameSel.appendChild(opt); });
      if (nm) nameSel.value = nm;
      const rankSel = document.createElement('select'); rankSel.className='eq-upg-rank';
      function refreshRanks(){ const cur = rulesUpgs.find(u=>u.name===nameSel.value); const maxR=Math.max(1, cur?.ranks||1); rankSel.innerHTML = Array.from({length:maxR}, (_,i)=>`<option value="${i+1}">${i+1}</option>`).join(''); }
      refreshRanks(); if (rk) rankSel.value = String(rk);
      const rem = document.createElement('button'); rem.type='button'; rem.className='secondary'; rem.textContent='Remove'; rem.onclick = ()=>{ row.remove(); commit(); };
      const ctrls = document.createElement('div'); ctrls.className='row-btns'; ctrls.appendChild(rem);
      nameSel.onchange = ()=>{ refreshRanks(); commit(); }; rankSel.onchange = commit;
      row.appendChild(nameSel); row.appendChild(rankSel); row.appendChild(ctrls); upgList.appendChild(row);
    }
    function findRuleItemByName(name) {
      const doc = state.rules?.items || {}; const matches=[];
      (function scan(val){ if (Array.isArray(val)) { for (const it of val) { if (it && it.name && String(it.name).toLowerCase()===String(name).toLowerCase()) matches.push(it); } } else if (val && typeof val==='object'){ for (const v of Object.values(val)) scan(v);} })(doc);
      return matches[0]||null;
    }
    function isWeapon(rule){ if (!rule) return false; const s = JSON.stringify(rule).toLowerCase(); return !!(rule.damage || /weapon|damage/.test(s)); }
    function isHelmet(name){ return /helmet|cap|hat/i.test(name); }
    function isTorso(name){ return /chest|torso|vest/i.test(name); }
    function isLegs(name){ return /legs|greaves|boots/i.test(name); }
    function commit(){
      const equipment = { Armor: armorSel.value || '' };
      const equipmentUpgrades = {};
      upgList.querySelectorAll('.row').forEach(r=>{ const n=r.querySelector('.eq-upg-name')?.value||''; const rk=Number(r.querySelector('.eq-upg-rank')?.value||0); if (n && rk>0) equipmentUpgrades[n]=rk; });
      // Weapons/other slots
      const w1 = weapCard.querySelector('#eq-w1');
      const w2 = weapCard.querySelector('#eq-w2');
      const hSel = otherCard.querySelector('#eq-helmet');
      const tSel = otherCard.querySelector('#eq-torso');
      const lSel = otherCard.querySelector('#eq-legs');
      equipment['Weapon 1'] = w1?.value || '';
      equipment['Weapon 2'] = w2?.value || '';
      equipment['Helmet'] = hSel?.value || '';
      equipment['Torso'] = tSel?.value || '';
      equipment['Legs'] = lSel?.value || '';
      // Server enforces "only upgrades you own"
      socket.emit('character:update', { id: c.id, updates: { equipment, equipmentUpgrades } });
    }
    // Prefill upgrades
    const flatUpgs = (()=>{
      const raw = upgs || {}; if (Object.values(raw).some(v => typeof v === 'object' && !Array.isArray(v))) { const merged={}; Object.values(raw).forEach(m=>{ for (const [k,v] of Object.entries(m)) merged[k]=v; }); return merged; } return raw; })();
    Object.entries(flatUpgs).forEach(([n,r])=> makeRow(n,r));
    upgAdd.onclick = ()=>{ const first = rulesUpgs[0]?.name || ''; makeRow(first,1); commit(); };
    upgClear.onclick = ()=>{ upgList.innerHTML=''; commit(); };
    armorSel.onchange = commit;
    // Populate weapons and other slots from inventory
    const inv = (c.inventory||[]);
    const weaponNames = inv.filter(n => isWeapon(findRuleItemByName(n)));
    const w1 = weapCard.querySelector('#eq-w1'); const w2 = weapCard.querySelector('#eq-w2');
    w1.innerHTML = `<option value="">None</option>` + weaponNames.map(n=>`<option value="${n}">${n}</option>`).join('');
    w2.innerHTML = w1.innerHTML;
    w1.value = equipped['Weapon 1'] || '';
    w2.value = equipped['Weapon 2'] || '';
    const hSel = otherCard.querySelector('#eq-helmet');
    const tSel = otherCard.querySelector('#eq-torso');
    const lSel = otherCard.querySelector('#eq-legs');
    const helmets = inv.filter(n=>isHelmet(n));
    const torsos = inv.filter(n=>isTorso(n));
    const legs = inv.filter(n=>isLegs(n));
    hSel.innerHTML = `<option value="">None</option>` + helmets.map(n=>`<option value="${n}">${n}</option>`).join('');
    tSel.innerHTML = `<option value="">None</option>` + torsos.map(n=>`<option value="${n}">${n}</option>`).join('');
    lSel.innerHTML = `<option value="">None</option>` + legs.map(n=>`<option value="${n}">${n}</option>`).join('');
    hSel.value = equipped['Helmet'] || '';
    tSel.value = equipped['Torso'] || '';
    lSel.value = equipped['Legs'] || '';
    w1.onchange = commit; w2.onchange = commit; hSel.onchange = commit; tSel.onchange = commit; lSel.onchange = commit;
    if (el.backToSheetFromEquip) el.backToSheetFromEquip.onclick = () => show(el.characterSheetView);
  }

  // Global search
  function openSearch(){ if (!el.searchOverlay) return; el.searchOverlay.classList.remove('hidden'); if (el.searchInput){ el.searchInput.value=''; renderSearch('all',''); el.searchInput.focus(); } }
  function renderSearch(filter, q){
    if (!el.searchResults) return;
    const items=[];
    (function(){ const doc = state.rules?.items||{}; function take(val,cat){ if(Array.isArray(val)){ for(const it of val){ if(it&&it.name) items.push({type:'Item', name:it.name, desc:it.description||'', obj: it, category: cat||''}); } } else if(val&&typeof val==='object'){ for(const [k,v] of Object.entries(val)) take(v,k);} } take(doc,''); })();
    const perksArr = Array.isArray(state.rules?.perks) ? state.rules.perks : (Array.isArray(state.rules?.Perks) ? state.rules.Perks : (Array.isArray(state.rules?.perks?.perks) ? state.rules.perks.perks : []));
    perksArr.forEach(p=> items.push({ type:'Perk', name: p.name||p.Name, desc: p.effect||p.description||'', obj: p }));
    const traitsArr = Array.isArray(state.rules?.traits) ? state.rules.traits : (Array.isArray(state.rules?.Traits) ? state.rules.Traits : []);
    traitsArr.forEach(t=> items.push({ type:'Trait', name: t.name||t.Name, desc: t.effect||t.description||'', obj: t }));
    (state.rules?.conditions||[]).forEach(c=> items.push({ type:'Condition', name: c.Name, desc: Array.isArray(c.Effects)? c.Effects.join(' ') : '', obj: c }));
    const want = String(q||'').toLowerCase();
    let res = items.filter(x=> (filter==='all' || x.type===filter) && (!want || (String(x.name||'').toLowerCase().includes(want) || String(x.desc||'').toLowerCase().includes(want)))).slice(0,300);
    el.searchResults.innerHTML='';
    const list = document.createElement('div'); list.className='list';
    // Add category picker for items next to existing filters
    if (filter === 'Item') {
      const cats = Array.from(new Set(res.map(r=>r.category).filter(Boolean))).sort();
      const categorySelect = document.createElement('select');
      categorySelect.id = 'itemCategoryFilter';
      categorySelect.style.marginLeft = 'auto';
      categorySelect.innerHTML = `<option value="all">All Categories</option>${cats.map(c=>`<option value="${c}">${c}</option>`).join('')}`;
      
      // Find existing filter buttons and add category select after them
      const existingFilters = el.searchResults.querySelector('.filter-btn');
      if (existingFilters) {
        existingFilters.parentNode.appendChild(categorySelect);
      } else {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.appendChild(categorySelect);
        el.searchResults.appendChild(toolbar);
      }
      
      const applyCat = () => {
        const chosen = categorySelect.value;
        const filtered = res.filter(r => chosen==='all' || r.category===chosen);
        list.innerHTML = '';
        filtered.forEach(r=> list.appendChild(renderSearchCard(r)));
      };
      categorySelect.onchange = applyCat;
      function renderSearchCard(r){
        const d=document.createElement('div'); d.className='item';
        const extra = (()=>{ 
          if (r.type==='Item' && r.obj){ 
            const o=r.obj; 
            const bits=[]; 
            if(o.damage) bits.push(`Damage: ${o.damage}`); 
            if(o.range||o.Range) bits.push(`Range: ${o.range||o.Range}`); 
            if(o.ap||o.AP) bits.push(`AP: ${o.ap||o.AP}`); 
            if(o.critical||o.Critical) bits.push(`Critical: ${o.critical||o.Critical}`); 
            if(o.carry_load) bits.push(`Load: ${typeof o.carry_load==='object'? (o.carry_load.full||o.carry_load.empty||0):o.carry_load}`);
            if(o.healing) bits.push(`Heals: ${o.healing} HP`);
            if(o.stamina) bits.push(`Stamina: ${o.stamina} SP`);
            if(o.radiation) bits.push(`Radiation: ${o.radiation}`);
            if(o.addiction) bits.push(`Addiction: ${o.addiction}`);
            if(o.duration) bits.push(`Duration: ${o.duration}`);
            if(o.effects) bits.push(`Effects: ${o.effects}`);
            if(o.weight) bits.push(`Weight: ${o.weight}`);
            if(o.value) bits.push(`Value: ${o.value} caps`);
            if(o.rarity) bits.push(`Rarity: ${o.rarity}`);
            if(o.tags) bits.push(`Tags: ${Array.isArray(o.tags) ? o.tags.join(', ') : o.tags}`);
            return bits.join(' • ');} 
          return ''; 
        })();
        d.innerHTML = `<h3>${r.name}</h3><div class=\"meta\">${r.type}${r.category?` • ${r.category}`:''}</div>${r.desc?`<div class=\"muted\">${r.desc}</div>`:''}${extra?`<div class=\"meta\">${extra}</div>`:''}`;
        return d;
      }
      applyCat();
      el.searchResults.appendChild(list);
      return;
    }
    res.forEach(r=>{ const d=document.createElement('div'); d.className='item';
      const extra = (()=>{
        if (r.type==='Item' && r.obj){ 
          const o=r.obj; 
          const bits=[]; 
          if(o.damage) bits.push(`Damage: ${o.damage}`); 
          if(o.range||o.Range) bits.push(`Range: ${o.range||o.Range}`); 
          if(o.ap||o.AP) bits.push(`AP: ${o.ap||o.AP}`); 
          if(o.critical||o.Critical) bits.push(`Critical: ${o.critical||o.Critical}`); 
          if(o.armor_class) bits.push(`AC: ${o.armor_class}`); 
          if(o.damage_threshold) bits.push(`DT: ${o.damage_threshold}`); 
          if(o.carry_load) bits.push(`Load: ${typeof o.carry_load==='object'? (o.carry_load.full||o.carry_load.empty||0):o.carry_load}`);
          if(o.healing) bits.push(`Heals: ${o.healing} HP`);
          if(o.stamina) bits.push(`Stamina: ${o.stamina} SP`);
          if(o.radiation) bits.push(`Radiation: ${o.radiation}`);
          if(o.addiction) bits.push(`Addiction: ${o.addiction}`);
          if(o.duration) bits.push(`Duration: ${o.duration}`);
          if(o.effects) bits.push(`Effects: ${o.effects}`);
          if(o.weight) bits.push(`Weight: ${o.weight}`);
          if(o.value) bits.push(`Value: ${o.value} caps`);
          if(o.rarity) bits.push(`Rarity: ${o.rarity}`);
          if(o.tags) bits.push(`Tags: ${Array.isArray(o.tags) ? o.tags.join(', ') : o.tags}`);
          return bits.join(' • '); 
        }
        return '';
      })();
      const perkBlock = (r.type==='Perk' && r.obj) ? `<div class=\"meta\">${r.obj.prerequisite||r.obj.requirement||''}</div>${(r.desc?`<div class=\"muted\">${r.desc}</div>`:'')}` : (r.desc?`<div class=\"muted\">${r.desc}</div>`:'');
      d.innerHTML = `<h3>${r.name}</h3><div class=\"meta\">${r.type}${r.category?` • ${r.category}`:''}</div>${perkBlock}${extra?`<div class=\"meta\">${extra}</div>`:''}`; list.appendChild(d); });
    el.searchResults.appendChild(list);
  }
  // Search overlay events
  if (el.hamburger) el.hamburger.onclick = () => openSearch();
  if (el.searchClose) el.searchClose.onclick = () => { if (el.searchOverlay) el.searchOverlay.classList.add('hidden'); };
  if (el.searchOverlay) el.searchOverlay.addEventListener('click', (e)=>{ if (e.target === el.searchOverlay) el.searchOverlay.classList.add('hidden'); });
  if (el.searchInput) el.searchInput.oninput = () => renderSearch(document.querySelector('.filter-btn.active')?.getAttribute('data-filter')||'all', el.searchInput.value);
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('.filter-btn'); if (!b) return;
    document.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    renderSearch(b.getAttribute('data-filter')||'all', el.searchInput?.value||'');
  });
  
    // Try auto session
    (async () => {
      try {
        // Load rules first
        const rulesRes = await fetch('/rules.json');
        if (rulesRes.ok) state.rules = await rulesRes.json();
      // Normalize perks/traits fallback keys for picker and search
      if (!Array.isArray(state.rules?.perks) && Array.isArray(state.rules?.Perks)) state.rules.perks = state.rules.Perks;
      if (!Array.isArray(state.rules?.traits) && Array.isArray(state.rules?.Traits)) state.rules.traits = state.rules.Traits;
        const { user } = await api('/api/me');
        me = user; setUserBox();
        show(el.charactersView);
        connectSocket();
      } catch {}
  })();
  
  // Perk & Trait pickers
  function openPerkPicker(){
    if (!el.perkPicker) return;
    if (!Array.isArray(state.rules?.perks)) {
      if (Array.isArray(state.rules?.Perks)) state.rules.perks = state.rules.Perks; else if (Array.isArray(state.rules?.perks?.perks)) state.rules.perks = state.rules.perks.perks; else return;
    }
    el.perkPicker.classList.remove('hidden');
    el.perkPickerGrid.innerHTML = '';
    const list = document.createElement('div'); list.className = 'list';
    state.rules.perks.slice(0, 300).forEach(p => {
      const d = document.createElement('div'); d.className='item';
      const prereq = p.prerequisite || p.requirement || '';
      const eff = p.effect || p.description || '';
      d.innerHTML = `<h3>${p.name}</h3>${prereq?`<div class="meta">Req: ${prereq}</div>`:''}${eff?`<div class="muted">${eff}</div>`:''}<div class="row-btns"><button data-pick="${p.name}">Add</button></div>`;
      list.appendChild(d);
    });
    el.perkPickerGrid.appendChild(list);
    el.perkPickerGrid.onclick = (e) => {
      const b = e.target.closest('button[data-pick]'); if (!b) return;
      const name = b.getAttribute('data-pick');
      const input = qs('#cr-perks');
      const cur = (input.value || '').split(',').map(s=>s.trim()).filter(Boolean);
      if (!cur.includes(name)) cur.push(name);
      input.value = cur.join(', ');
    };
    if (el.perkPickerClose) el.perkPickerClose.onclick = () => el.perkPicker.classList.add('hidden');
    el.perkPicker.addEventListener('click', (e)=>{ if (e.target === el.perkPicker) el.perkPicker.classList.add('hidden'); });
  }
  function openTraitPicker(){
    if (!el.traitPicker) return;
    if (!Array.isArray(state.rules?.traits)) {
      if (Array.isArray(state.rules?.Traits)) state.rules.traits = state.rules.Traits; else return;
    }
    el.traitPicker.classList.remove('hidden');
    el.traitPickerGrid.innerHTML = '';
    const list = document.createElement('div'); list.className = 'list';
    state.rules.traits.slice(0, 300).forEach(t => {
      const d = document.createElement('div'); d.className='item';
      const prereq = t.prerequisite || '';
      const eff = t.effect || t.description || '';
      d.innerHTML = `<h3>${t.name}</h3>${prereq?`<div class="meta">Req: ${prereq}</div>`:''}${eff?`<div class="muted\">${eff}</div>`:''}<div class="row-btns"><button data-pick="${t.name}">Select</button></div>`;
      list.appendChild(d);
    });
    el.traitPickerGrid.appendChild(list);
    el.traitPickerGrid.onclick = (e) => {
      const b = e.target.closest('button[data-pick]'); if (!b) return;
      const name = b.getAttribute('data-pick');
      const input = document.getElementById('cr-trait');
      input.value = name;
      el.traitPicker.classList.add('hidden');
    };
    if (el.traitPickerClose) el.traitPickerClose.onclick = () => el.traitPicker.classList.add('hidden');
    el.traitPicker.addEventListener('click', (e)=>{ if (e.target === el.traitPicker) el.traitPicker.classList.add('hidden'); });
  }

  // Login form
  el.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(el.loginForm);
    const name = String(fd.get('name')||'').trim();
    const role = String(fd.get('role')||'player');
    const dmKey = String(fd.get('dmKey')||'').trim();
    if (!name) return;
    const payload = { name, role };
    if (role === 'dm' && dmKey) payload.dmKey = dmKey;
    const btn = el.loginForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
    try {
      const res = await fetch('/api/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      me = data.user;
      setUserBox();
      show(el.charactersView);
      connectSocket();
    } catch (err) {
      console.error('Login error', err);
      alert(String(err?.message||'Login failed'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    }
  };

  // Back buttons and navigation hooks
  if (el.backToChars) el.backToChars.onclick = () => show(el.charactersView);
  if (el.backToCharsFromInv) el.backToCharsFromInv.onclick = () => show(el.charactersView);
  if (el.backToCharsFromEquip) el.backToCharsFromEquip.onclick = () => show(el.charactersView);
  if (el.backToCharsFromShop) el.backToCharsFromShop.onclick = () => show(el.charactersView);
  if (el.backToCharsFromCraft) el.backToCharsFromCraft.onclick = () => show(el.charactersView);
  if (el.backToCharsFromAssist) el.backToCharsFromAssist.onclick = () => show(el.charactersView);
  if (el.backToCharsFromCond) el.backToCharsFromCond.onclick = () => show(el.charactersView);
  if (el.openInventory) el.openInventory.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openInventory(c);
  };
  if (el.openEquipment) el.openEquipment.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openEquipment(c);
  };
  if (el.openShop) el.openShop.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openShop(c);
  };
  if (el.openCrafting) el.openCrafting.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openCrafting(c);
  };
  if (el.openConditions) el.openConditions.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openConditions(c);
  };
  if (el.openAssist) el.openAssist.onclick = () => {
    const c = state.characters.find(x=>x.id===state.selectedCharacterId); if (c) openAssist(c);
  };
  if (el.logoutBtn) el.logoutBtn.onclick = async () => {
    try { await fetch('/api/logout', { method:'POST', credentials:'include' }); } catch {}
    me = null; setUserBox(); show(el.accountView);
  };

  // Toggle DM key field visibility
  const roleSel = document.getElementById('role');
  const dmKeyRow = document.getElementById('dmKeyRow');
  if (roleSel && dmKeyRow) {
    const refresh = () => { if (roleSel.value === 'dm') dmKeyRow.classList.remove('hidden'); else dmKeyRow.classList.add('hidden'); };
    roleSel.onchange = refresh; refresh();
  }

})();
