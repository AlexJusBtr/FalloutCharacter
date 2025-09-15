const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: true,
		credentials: true
	}
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- Rules aggregation (in-memory cache) --------------------
let RULES_CACHE = null;
let ITEM_WEIGHT_INDEX = null;

function readJsonSafe(relPath) {
	try {
		const p = path.join(__dirname, 'public', relPath);
		if (!fs.existsSync(p)) return null;
		return JSON.parse(fs.readFileSync(p, 'utf-8'));
	} catch (e) {
		console.error('Failed to read JSON', relPath, e.message);
		return null;
	}
}

function buildItemWeightIndex(itemsDoc) {
	const index = new Map();
	if (!itemsDoc || typeof itemsDoc !== 'object') return index;
	function addItem(name, carry) {
		if (!name) return;
		let weight = 0;
		if (typeof carry === 'number') weight = carry;
		else if (carry && typeof carry === 'object') weight = Number(carry.full ?? carry.empty ?? 0) || 0;
		index.set(String(name).toLowerCase(), weight);
	}
	for (const [key, val] of Object.entries(itemsDoc)) {
		if (Array.isArray(val)) {
			for (const it of val) addItem(it.name, it.carry_load);
		} else if (typeof val === 'object') {
			for (const [subKey, subVal] of Object.entries(val)) {
				if (Array.isArray(subVal)) {
					for (const it of subVal) addItem(it.name, it.carry_load);
				}
			}
		}
	}
	return index;
}

function generateSkillsFromAbilities(abilitiesDoc) {
	// Build skills list with base formulas using SPECIAL and Luck modifier
	const list = abilitiesDoc?.SkillChecks?.SkillsList || [];
	const skills = [];
	for (const s of list) {
		const name = s.Name;
		const prim = s.PrimaryAbility || '';
		let formula = '0';
		if (prim.includes(' or ')) {
			// e.g., "Perception or Intelligence" -> max(P-5, I-5)
			const parts = prim.split(' or ').map(x => x.trim());
			const sym = parts.map(p => p[0]).join(',');
			formula = `max(${parts.map(p => `${p[0]} - 5`).join(', ')}) + (L - 5)`;
		} else if (prim) {
			const sym = prim[0];
			formula = `(${sym} - 5) + (L - 5)`;
		}
		skills.push({ name, baseFormula: formula });
	}
	return skills;
}

function loadUnifiedRules() {
	const ability = readJsonSafe('ability_scores_skills.json');
	const backgrounds = readJsonSafe('backgrounds.json');
	const crafting = readJsonSafe('crafting_decay_blueprints.json');
	const condLoot = readJsonSafe('conditions_and_loot_gm_section.json');
	const items = readJsonSafe('items.json');
	const traitsRaw = readJsonSafe('traits.json');
	const perksRaw = readJsonSafe('perks.json');
	const racesDoc = readJsonSafe('character_creation_leveling_races.json');
	const races = Array.isArray(racesDoc?.races) ? racesDoc.races : [
		{ name: 'Human' }, { name: 'Ghoul' }, { name: 'Super Mutant' }, { name: 'Synth' }
	];
	const skills = generateSkillsFromAbilities(ability);
	// Normalize traits/perks
	const traits = Array.isArray(backgrounds?.Traits) ? backgrounds.Traits : (Array.isArray(traitsRaw?.traits) ? traitsRaw.traits : (Array.isArray(traitsRaw?.Traits) ? traitsRaw.Traits : (Array.isArray(traitsRaw) ? traitsRaw : [])));
	const perks = Array.isArray(perksRaw?.Perks) ? perksRaw.Perks : (Array.isArray(perksRaw?.perks) ? perksRaw.perks : (Array.isArray(perksRaw) ? perksRaw : []));
	const rules = {
		special: {
			min: 1,
			max: 10,
			pointBudget: 28,
			derived: {
				maxHpFormula: '10 + (E - 5)',
				apFormula: '10 + (A - 5)',
				spFormula: '10 + (A - 5)'
			}
		},
		skills,
		races: races,
		backgrounds: Array.isArray(backgrounds?.Backgrounds) ? backgrounds.Backgrounds : [],
		traits,
		perks,
		crafting: crafting || {},
		items: items || {},
		conditions: Array.isArray(condLoot?.ConditionsAndLoot?.Conditions) ? condLoot.ConditionsAndLoot.Conditions : []
	};
	RULES_CACHE = rules;
	ITEM_WEIGHT_INDEX = buildItemWeightIndex(items || {});
	return rules;
}

app.get('/rules.json', (req, res) => {
	try {
		const rules = loadUnifiedRules();
		res.json(rules);
	} catch (e) {
		res.status(500).json({ error: 'Failed to load rules' });
	}
});

// -------------------- Derived stat helpers --------------------
function computeAbilityMod(score) {
	const n = Number(score || 0);
	return n - 5;
}

function sumInventoryWeight(inv) {
	if (!Array.isArray(inv)) return 0;
	let total = 0;
	for (const name of inv) {
		const w = ITEM_WEIGHT_INDEX?.get(String(name).toLowerCase()) || 0;
		total += Number(w) || 0;
	}
	return total;
}

function computeDerived(character) {
	const S = Number(character?.special?.S || 1);
	const E = Number(character?.special?.E || 1);
	const A = Number(character?.special?.A || 1);
	const L = Number(character?.special?.L || 1);
	const maxHp = Math.max(1, 10 + (E - 5));
	const ap = Math.max(1, 10 + (A - 5));
	const sp = Math.max(1, 10 + (A - 5));
	const carryMax = Math.max(0, S * 10);
	const carryCurrent = sumInventoryWeight(character?.inventory || []);
	// AC/DT from equipment: look up armor pieces in items.json Armor list, sum AC and DT
	let ac = 10;
	let dt = 0;
	let radiationDc = Math.max(0, 12 - (E - 5));
	try {
		const eq = character?.equipment ? Object.values(character.equipment) : [];
		const armors = (RULES_CACHE?.items?.Armor || []);
		for (const slotItem of eq) {
			const a = armors.find(x => String(x.name).toLowerCase() === String(slotItem || '').toLowerCase());
			if (a) { ac += Number(a.armor_class || 0) - 10; dt += Number(a.damage_threshold || 0); }
		}
		// Apply upgrades if present (support global map or per-slot maps)
		const armorUp = (RULES_CACHE?.items?.['Armor Upgrades'] || []);
		const upsRaw = character?.equipmentUpgrades || {};
		const upsList = [];
		if (Object.values(upsRaw).some(v => typeof v === 'object' && !Array.isArray(v))) {
			for (const slot of Object.keys(upsRaw)) {
				const m = upsRaw[slot] || {};
				for (const [n, r] of Object.entries(m)) upsList.push([n, r]);
			}
		} else {
			for (const [n, r] of Object.entries(upsRaw)) upsList.push([n, r]);
		}
		for (const [upName, rankVal] of upsList) {
			const up = armorUp.find(u => String(u.name).toLowerCase() === String(upName).toLowerCase());
			const r = Number(rankVal||1);
			if (!up || r <= 0) continue;
			if (up.name === 'Reinforced') dt += r;
			if (up.name === 'Hardened') ac += r;
			if (up.name === 'Lead Lined') radiationDc = Math.max(0, radiationDc - 2 * r);
			if (up.name === 'Sturdy') {
				character.derived = character.derived || {};
				character.derived.sturdyIgnoreLevels = Math.max(Number(character.derived.sturdyIgnoreLevels||0), r === 1 ? 2 : (r === 2 ? 4 : 4));
				character.derived.armorNoCritDecay = character.derived.armorNoCritDecay || (r === 3);
			}
		}
	} catch {}

	// Apply simple perk/trait effects and Wild Wasteland variants (pattern-based)
	try {
		const applyEffectText = (text) => {
			if (!text || typeof text !== 'string') return;
			let m;
			m = text.match(/carry\s*load\s*increases\s*by\s*(\d+)/i); if (m) { const inc = Number(m[1]); if (Number.isFinite(inc)) d.carryMax = (d.carryMax||0) + inc; }
			m = text.match(/ac\s*(?:is\s*)?(increased|decreased|reduced)\s*by\s*(\d+)/i); if (m) { const n = Number(m[2]); if (m[1].toLowerCase()==='increased') ac += n; else ac -= n; }
			m = text.match(/dt\s*(?:is\s*)?(increased|decreased|reduced)\s*by\s*(\d+)/i); if (m) { const n = Number(m[2]); if (m[1].toLowerCase()==='increased') dt += n; else dt -= n; }
			m = text.match(/radiation\s*dc\s*(?:is\s*)?(increased|decreased|reduced)\s*by\s*(\d+)/i); if (m) { const n = Number(m[2]); if (m[1].toLowerCase()==='increased') radiationDc += n; else radiationDc = Math.max(0, radiationDc - n); }
			m = text.match(/strength\s*score\s*increases\s*by\s*(\d+)/i); if (m) { const n = Number(m[1]); if (Number.isFinite(n)) { d.carryMax += 10 * n; } }
		};
		const d = { maxHp, ap, sp, carryMax, carryCurrent, ac, dt, radiationDc };
		const rules = RULES_CACHE || loadUnifiedRules();
		// Trait
		if (character.trait) {
			const t = (rules.traits||[]).find(x => String(x.name||x.Name).toLowerCase() === String(character.trait).toLowerCase());
			if (t) applyEffectText(t.effect || t.description || '');
			// Optional Wild Wasteland variant if user encodes with "(Wild)" in trait field
			if (/\(\s*wild\s*\)/i.test(String(character.trait)) && t?.wildWasteland) applyEffectText(t.wildWasteland);
		}
		// Perks (apply text patterns; handle repeats by applying multiple times if duplicated)
		const perks = Array.isArray(character.perks) ? character.perks : [];
		for (const perkName of perks) {
			const p = (rules.perks||[]).find(x => String(x.name||x.Name).toLowerCase() === String(perkName).toLowerCase());
			if (p) applyEffectText(p.effect || p.description || '');
		}
		// Reassign possibly modified values
		ac = d.ac; dt = d.dt; carryMax = d.carryMax; radiationDc = d.radiationDc; maxHp = d.maxHp; ap = d.ap; sp = d.sp; carryCurrent = d.carryCurrent;
	} catch {}
	return { maxHp, ap, sp, carryMax, carryCurrent, luckMod: (L - 5), ac, dt, radiationDc };
}

function withDerivedPersisted(char) {
	const d = computeDerived(char);
	char.maxHp = d.maxHp;
	char.hp = Math.min(char.hp || d.maxHp, d.maxHp);
	char.derived = d;
	return char;
}

// -------------------- Leveling helpers --------------------
function xpThresholdFor(level) {
	return Math.max(50, 100 * level);
}
function ensureLevelProgression(char) {
	let changed = false;
	for (;;) {
		const nextThresh = xpThresholdFor(char.level);
		if ((char.xp || 0) >= nextThresh) {
			char.level = (char.level || 1) + 1;
			const intMod = Number((char.special?.I || 5) - 5);
			const gained = Math.max(1, intMod + 1);
			char.unspentSkillPoints = Math.max(0, Number(char.unspentSkillPoints || 0) + gained);
			char.totalSkillPointsGranted = Number(char.totalSkillPointsGranted||0) + gained;
			if ((char.level % 2) === 0) char.unspentSpecialPoints = Math.max(0, Number(char.unspentSpecialPoints || 0) + 1);
			changed = true;
		} else break;
	}
	return changed;
}

// Optional MongoDB
const useMongo = !!process.env.MONGO_URL;
if (useMongo) {
	mongoose.connect(process.env.MONGO_URL, { autoIndex: true }).then(() => {
		console.log('MongoDB connected');
	}).catch((e) => console.error('MongoDB connect error', e));

	const userSchema = new mongoose.Schema({
		userId: { type: String, unique: true },
		name: String,
		role: { type: String, enum: ['player','dm'] }
	}, { timestamps: true });
	const characterSchema = new mongoose.Schema({
		id: { type: String, unique: true },
		name: String,
		ownerId: String,
		ruleSet: { type: String, default: 'fallout' },
		race: String,
		background: String,
		trait: String,
		special: {
			S: Number, P: Number, E: Number, C: Number, I: Number, A: Number, L: Number
		},
		perks: [String],
		level: { type: Number, default: 1 },
		xp: { type: Number, default: 0 },
		hp: { type: Number, default: 1 },
		maxHp: { type: Number, default: 1 },
		caps: { type: Number, default: 0 },
		inventory: [String],
		materials: { type: Map, of: Number, default: {} },
		equipment: { type: Map, of: String, default: {} },
		equipmentUpgrades: { type: Map, of: String, default: {} },
		conditions: { type: [String], default: [] },
		deathSaves: { type: Object, default: { s: 0, f: 0 } },
		skillsPoints: { type: Map, of: Number, default: {} },
		unspentSkillPoints: { type: Number, default: 0 },
		unspentSpecialPoints: { type: Number, default: 0 },
		totalSkillPointsGranted: { type: Number, default: 0 },
		derived: { type: Object, default: {} },
		shopAccess: { type: Boolean, default: false },
		backgroundSkillBonuses: { type: Map, of: Number, default: {} }
	}, { timestamps: true });
	const shopItemSchema = new mongoose.Schema({
		id: { type: String, unique: true },
		name: String,
		cost: Number,
		stock: Number,
		description: String
	}, { timestamps: true });
	global.DB = {
		User: mongoose.model('User', userSchema),
		Character: mongoose.model('Character', characterSchema),
		ShopItem: mongoose.model('ShopItem', shopItemSchema)
	};
}

// In-memory fallback state
const sessions = new Map(); // sid -> { userId, role }
const users = new Map(); // userId -> { userId, name, role }
const characters = new Map(); // charId -> character object
const shopItems = new Map(); // id -> { id, name, cost, stock, description }
const combatState = { enemies: [], initiative: [] }; // simple in-memory combat

function getSession(req) {
	const sid = req.cookies.sid;
	if (!sid) return null;
	return sessions.get(sid) || null;
}

app.post('/api/login', async (req, res) => {
	const { name, role } = req.body || {};
	const dmKey = req.body?.dmKey;
	let reqRole = role;
	let cleanName = String(name||'').trim();
	if (typeof cleanName !== 'string' || !cleanName) {
		return res.status(400).json({ error: 'Invalid name or role' });
	}
	// DM keyword support
	const hasDmToken = /(^dm:)|(#dm\b)|(\[dm\])/i.test(cleanName);
	if (hasDmToken) cleanName = cleanName.replace(/(^dm:)|(#dm\b)|(\[dm\])/ig, '').trim();
	if (dmKey && String(dmKey) === String(process.env.DM_KEY || 'letmein')) reqRole = 'dm';
	if (hasDmToken) reqRole = 'dm';
	if (!reqRole || !['player','dm'].includes(reqRole)) {
		return res.status(400).json({ error: 'Invalid name or role' });
	}
	let existing = null;
	if (useMongo) {
		existing = await DB.User.findOne({ name: cleanName, role: reqRole }).lean();
		if (!existing) {
			const userId = (reqRole === 'dm' ? 'dm-' : 'p-') + uuidv4();
			await DB.User.create({ userId, name: cleanName, role: reqRole });
			existing = { userId, name: cleanName, role: reqRole };
		}
	} else {
		for (const u of users.values()) { if (u.name === cleanName && u.role === reqRole) { existing = u; break; } }
		if (!existing) { const userId = (reqRole === 'dm' ? 'dm-' : 'p-') + uuidv4(); existing = { userId, name: cleanName, role: reqRole }; users.set(userId, existing); }
	}
	const sid = uuidv4();
	sessions.set(sid, { userId: existing.userId, role: existing.role });
	res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
	return res.json({ user: existing });
});

app.post('/api/logout', (req, res) => {
	const sid = req.cookies.sid;
	if (sid) sessions.delete(sid);
	res.clearCookie('sid');
	res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	let user = null;
	if (useMongo) {
		user = await DB.User.findOne({ userId: s.userId }).lean();
	} else {
		user = users.get(s.userId);
	}
	res.json({ user });
});

app.get('/api/characters', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	let list = [];
	if (useMongo) {
		list = await DB.Character.find({}).lean();
	} else {
		list = Array.from(characters.values());
	}
	// Ensure derived present
	loadUnifiedRules();
	const withDer = list.map(c => withDerivedPersisted({ ...c }));
	// Attach owner names for DM and for players' own characters
	const withOwners = withDer.map(c => {
		const owner = useMongo ? null : users.get(c.ownerId);
		return { ...c, ownerName: owner?.name || c.ownerName || null };
	});
	let out = withDer;
	if (s.role === 'player') {
		out = withOwners.map(c => (c.ownerId === s.userId ? c : { id: c.id, name: c.name, ownerId: c.ownerId, ownerName: c.ownerName }));
	}
	res.json({ characters: s.role === 'dm' ? withOwners : out });
});

// Get my character (for player)
app.get('/api/my/character', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'player') return res.status(400).json({ error: 'Only players have a personal character' });
	let ch = null;
	if (useMongo) ch = await DB.Character.findOne({ ownerId: s.userId }).lean();
	else ch = Array.from(characters.values()).find(c => c.ownerId === s.userId) || null;
	res.json({ character: ch || null });
});

// Create character (one per player)
app.post('/api/character', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'player' && s.role !== 'dm') return res.status(403).json({ error: 'Forbidden' });
	// Players limited to one character; DM can create for testing with ownerId override
	const ownerId = req.body.ownerId && s.role === 'dm' ? req.body.ownerId : s.userId;
	let existing = null;
	if (useMongo) existing = await DB.Character.findOne({ ownerId }).lean();
	else existing = Array.from(characters.values()).find(c => c.ownerId === ownerId);
	if (existing) return res.status(400).json({ error: 'Character already exists for this player' });

	const id = 'c-' + uuidv4();
	const {
		name, race, background, trait,
		special = {}, perks = [],
		level = 1,
		customBackground
	} = req.body || {};
	if (!name) return res.status(400).json({ error: 'Name required' });
	const safeSPECIAL = {
		S: Number(special.S || 1), P: Number(special.P || 1), E: Number(special.E || 1), C: Number(special.C || 1), I: Number(special.I || 1), A: Number(special.A || 1), L: Number(special.L || 1)
	};
	loadUnifiedRules(); // ensure caches
	const maxHp = Math.max(1, 10 + (Number(safeSPECIAL.E || 1) - 5));
	let doc = {
		id, name, ownerId, race: race || '', background: background || '', trait: trait || '',
		special: safeSPECIAL, perks: Array.isArray(perks) ? perks.slice(0, 30) : [],
		level: Number(level) || 1,
		xp: 0, hp: maxHp, maxHp, caps: 0, inventory: [], materials: {}, derived: {}, shopAccess: false
	};
	// Assign starting equipment based on background + race if present in rules
	try {
		const rules = loadUnifiedRules();
		const bg = (rules.backgrounds || []).find(b => String(b.name).toLowerCase() === String(doc.background).toLowerCase());
		if (bg && bg.starting_equipment) {
			const key = Object.keys(bg.starting_equipment).find(k => k.toLowerCase().includes(String(doc.race || '').toLowerCase())) || Object.keys(bg.starting_equipment)[0];
			const items = Array.isArray(bg.starting_equipment[key]) ? bg.starting_equipment[key] : (typeof bg.starting_equipment[key] === 'string' ? [bg.starting_equipment[key]] : []);
			doc.inventory = [...doc.inventory, ...items];
			// Extract caps if present as "50 caps"
			const capsFrom = items.map(x => String(x)).filter(x => /\bcaps\b/i.test(x)).map(x => Number((x.match(/(\d+)/)||[])[1]||0));
			if (capsFrom.length) doc.caps += capsFrom.reduce((a,b)=>a+b,0);
		}
	} catch {}
	// Custom Background extras
	if (String(doc.background).toLowerCase() === 'custom background' && customBackground && typeof customBackground === 'object') {
		if (Array.isArray(customBackground.equipment)) {
			const items = customBackground.equipment.map(x=>String(x)).slice(0, 100);
			doc.inventory = [...doc.inventory, ...items];
		}
		if (customBackground.skillBonuses && typeof customBackground.skillBonuses === 'object') {
			// Expect mapping of skillName -> +2 (only three entries)
			doc.backgroundSkillBonuses = Object.fromEntries(Object.entries(customBackground.skillBonuses).slice(0, 10));
		}
	}
	doc = withDerivedPersisted(doc);
	if (useMongo) await DB.Character.create(doc); else characters.set(id, doc);
	io.emit('character:update', { character: doc });
	res.json({ character: doc });
});

app.post('/api/characters/:id', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	let char = null;
	if (useMongo) char = await DB.Character.findOne({ id: req.params.id });
	else char = characters.get(req.params.id);
	if (!char) return res.status(404).json({ error: 'Not found' });
	const isOwner = char.ownerId === s.userId;
	const isDm = s.role === 'dm';
	if (!isOwner && !isDm) return res.status(403).json({ error: 'Forbidden' });
	const { name, xp, hp, maxHp, caps, inventory, special, perks, race, background, level, materials } = req.body || {};
	if (typeof name === 'string') char.name = name;
	if (Number.isFinite(xp)) char.xp = xp;
	if (Number.isFinite(hp)) char.hp = Math.max(0, Math.min((maxHp ?? char.maxHp), hp));
	if (Number.isFinite(maxHp)) char.maxHp = maxHp;
	if (Number.isFinite(caps)) char.caps = caps;
	if (Array.isArray(inventory)) char.inventory = inventory.slice(0, 100);
	if (materials && typeof materials === 'object') {
		char.materials = Object.fromEntries(Object.entries(materials).slice(0, 200));
	}
	if (special && typeof special === 'object') {
		char.special = { ...char.special, ...special };
		// Derived handled below
	}
	if (Array.isArray(perks)) char.perks = perks.slice(0, 30);
	if (typeof race === 'string') char.race = race;
	if (typeof background === 'string') char.background = background;
	if (Number.isFinite(level)) char.level = Math.max(1, level);
	loadUnifiedRules();
	withDerivedPersisted(char);
	if (useMongo) {
		await char.save();
		io.emit('character:update', { character: char.toObject() });
		res.json({ character: char.toObject() });
	} else {
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
		res.json({ character: char });
	}
});

// DM grants shop access to a character
app.post('/api/characters/:id/shop', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
	let char = null;
	if (useMongo) char = await DB.Character.findOne({ id: req.params.id });
	else char = characters.get(req.params.id);
	if (!char) return res.status(404).json({ error: 'Not found' });
	const { allow } = req.body || {};
	char.shopAccess = !!allow;
	if (useMongo) { await char.save(); io.emit('character:update', { character: char.toObject() }); res.json({ character: char.toObject() }); }
	else { characters.set(char.id, char); io.emit('character:update', { character: char }); res.json({ character: char }); }
});

// Shop APIs
app.get('/api/shop', async (req, res) => {
	let items = [];
	if (useMongo) items = await DB.ShopItem.find({}).lean();
	else items = Array.from(shopItems.values());
	res.json({ items });
});

app.post('/api/shop', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
	const id = 'i-' + uuidv4();
	const { name, cost, stock, description } = req.body || {};
	if (!name || !Number.isFinite(Number(cost)) || !Number.isFinite(Number(stock))) return res.status(400).json({ error: 'Invalid item' });
	const doc = { id, name, cost: Number(cost), stock: Math.max(0, Number(stock)), description: description || '' };
	if (useMongo) await DB.ShopItem.create(doc); else shopItems.set(id, doc);
	const list = useMongo ? await DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
	io.emit('shop:update', { items: list });
	res.json({ item: doc });
});

app.patch('/api/shop/:id', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
	const { name, cost, stock, description } = req.body || {};
	let item = null;
	if (useMongo) item = await DB.ShopItem.findOne({ id: req.params.id }); else item = shopItems.get(req.params.id);
	if (!item) return res.status(404).json({ error: 'Not found' });
	if (typeof name === 'string') item.name = name;
	if (Number.isFinite(Number(cost))) item.cost = Number(cost);
	if (Number.isFinite(Number(stock))) item.stock = Math.max(0, Number(stock));
	if (typeof description === 'string') item.description = description;
	if (useMongo) await item.save(); else shopItems.set(item.id, item);
	const list = useMongo ? await DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
	io.emit('shop:update', { items: list });
	res.json({ item: useMongo ? item.toObject() : item });
});

app.delete('/api/shop/:id', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
	if (useMongo) await DB.ShopItem.deleteOne({ id: req.params.id }); else shopItems.delete(req.params.id);
	const list = useMongo ? await DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
	io.emit('shop:update', { items: list });
	res.json({ ok: true });
});

app.post('/api/shop/:id/buy', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	let char = null;
	if (useMongo) char = await DB.Character.findOne({ ownerId: s.userId });
	else char = Array.from(characters.values()).find(c => c.ownerId === s.userId);
	if (!char) return res.status(400).json({ error: 'No character' });
	if (!char.shopAccess && s.role !== 'dm') return res.status(403).json({ error: 'Shop not near' });
	let item = null;
	if (useMongo) item = await DB.ShopItem.findOne({ id: req.params.id }); else item = shopItems.get(req.params.id);
	if (!item) return res.status(404).json({ error: 'Item not found' });
	if (item.stock <= 0) return res.status(400).json({ error: 'Out of stock' });
	if (char.caps < item.cost) return res.status(400).json({ error: 'Not enough caps' });
	char.caps -= item.cost;
	char.inventory = [...(char.inventory || []), item.name];
	item.stock -= 1;
	if (useMongo) { await char.save(); await item.save(); }
	else { characters.set(char.id, char); shopItems.set(item.id, item); }
	io.emit('character:update', { character: useMongo ? char.toObject() : char });
	const list = useMongo ? await DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
	io.emit('shop:update', { items: list });
	res.json({ character: useMongo ? char.toObject() : char, item: useMongo ? item.toObject() : item });
});

// -------------------- Crafting --------------------
function normalizeMaterialsList(materials) {
	// Accept ["x2 cloth", "x1 steel"] or nested options
	const out = {};
	function addOne(entry) {
		if (typeof entry !== 'string') return;
		const m = entry.trim().match(/^x?(\d+)\s+(.+)$/i);
		if (!m) return;
		const qty = Number(m[1]);
		const name = m[2].toLowerCase();
		out[name] = (out[name] || 0) + qty;
	}
	if (Array.isArray(materials)) {
		for (const e of materials) {
			if (Array.isArray(e)) { for (const x of e) addOne(x); }
			else addOne(e);
		}
	}
	return out;
}

function findCraftRecipeByName(rules, name) {
	const doc = rules?.crafting || {};
	const targets = [];
	function scan(arr, type) {
		if (!Array.isArray(arr)) return;
		for (const it of arr) {
			if (String(it.Name).toLowerCase() === String(name).toLowerCase()) targets.push({ ...it, __type: type });
		}
	}
	for (const [k, v] of Object.entries(doc.CraftableItems || {})) scan(v, k);
	for (const [k, v] of Object.entries(doc || {})) {
		if (Array.isArray(v)) scan(v, k);
	}
	return targets[0] || null;
}

function computeSkillBonusFor(character, skillName) {
	loadUnifiedRules();
	const S = Number(character.special?.S || 1);
	const P = Number(character.special?.P || 1);
	const E = Number(character.special?.E || 1);
	const C = Number(character.special?.C || 1);
	const I = Number(character.special?.I || 1);
	const A = Number(character.special?.A || 1);
	const L = Number(character.special?.L || 1);
	const ab = { S, P, E, C, I, A, L };
	const skill = (RULES_CACHE?.skills || []).find(s => s.name.toLowerCase() === String(skillName).toLowerCase());
	if (!skill) return 0;
	// naive evaluator: replace symbols with numbers, and Math functions
	let expr = String(skill.baseFormula || '0');
	for (const [k, v] of Object.entries(ab)) expr = expr.replaceAll(k, String(v));
	try {
		// eslint-disable-next-line no-new-func
		const fn = new Function('max','min','floor','ceil', `return (${expr});`);
		const r = fn(Math.max, Math.min, Math.floor, Math.ceil);
		let base = Number.isFinite(r) ? Math.floor(r) : 0;
		// Add allocated skill points
		const extra = Number((character.skillsPoints||{})[skill.name] || 0);
		// Add background skill bonuses if present
		const bg = Number((character.backgroundSkillBonuses||{})[skill.name] || 0);
		return base + extra + bg;
	} catch { return 0; }
}

app.post('/api/craft', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	const { name } = req.body || {};
	if (!name) return res.status(400).json({ error: 'Item name required' });
	loadUnifiedRules();
	let char = null;
	if (useMongo) char = await DB.Character.findOne({ ownerId: s.userId });
	else char = Array.from(characters.values()).find(c => c.ownerId === s.userId);
	if (!char) return res.status(400).json({ error: 'No character' });
	const recipe = findCraftRecipeByName(RULES_CACHE, name);
	if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
	const mats = normalizeMaterialsList(recipe.Craft?.Materials || recipe.Craft?.materials || []);
	// Determine DC and skill
	let checkSkill = 'Crafting';
	let dc = 10;
	const dcField = recipe.Craft?.DC;
	if (typeof dcField === 'number') { dc = dcField; }
	else if (dcField && typeof dcField === 'object') {
		const first = Object.entries(dcField)[0];
		if (first) { checkSkill = first[0].split(' or ')[0]; dc = Number(first[1]) || dc; }
	}
	// Validate materials
	for (const [mat, need] of Object.entries(mats)) {
		const have = Number(char.materials?.[mat] || 0);
		if (have < need) return res.status(400).json({ error: `Missing material: ${mat} x${need}` });
	}
	// Skill check (do not add 10 baseline twice; DC field is direct)
	const bonus = computeSkillBonusFor(char, checkSkill);
	const roll = 1 + Math.floor(Math.random() * 20);
	const total = roll + bonus;
	const targetDc = Number(dc);
	const success = total >= targetDc;
	if (!success) {
		return res.json({ ok: false, roll, bonus, total, dc: targetDc, message: 'Crafting failed' });
	}
	// Consume materials
	const newMaterials = { ...(char.materials || {}) };
	for (const [mat, need] of Object.entries(mats)) newMaterials[mat] = Math.max(0, Number(newMaterials[mat] || 0) - need);
	char.materials = newMaterials;
	// Add item to inventory
	char.inventory = [...(char.inventory || []), recipe.Name];
	withDerivedPersisted(char);
	if (useMongo) { await char.save(); }
	else { characters.set(char.id, char); }
	io.emit('character:update', { character: useMongo ? char.toObject() : char });
	return res.json({ ok: true, character: useMongo ? char.toObject() : char, crafted: recipe.Name, roll, bonus, total });
});

// -------------------- DM Utilities --------------------
app.post('/api/characters/:id/materials', async (req, res) => {
	const s = getSession(req);
	if (!s) return res.status(401).json({ error: 'Not logged in' });
	if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
	let char = null;
	if (useMongo) char = await DB.Character.findOne({ id: req.params.id }); else char = characters.get(req.params.id);
	if (!char) return res.status(404).json({ error: 'Not found' });
	const { add = {}, remove = {}, set = null } = req.body || {};
	if (set && typeof set === 'object') char.materials = { ...set };
	else {
		char.materials = { ...(char.materials || {}) };
		for (const [k, v] of Object.entries(add)) char.materials[k.toLowerCase()] = Math.max(0, Number(char.materials[k.toLowerCase()] || 0) + Number(v || 0));
		for (const [k, v] of Object.entries(remove)) {
			const current = Number(char.materials[k.toLowerCase()] || 0);
			const toRemove = Number(v || 0);
			char.materials[k.toLowerCase()] = Math.max(0, current - toRemove);
			if (char.materials[k.toLowerCase()] === 0) delete char.materials[k.toLowerCase()];
		}
	}
	withDerivedPersisted(char);
	if (useMongo) { await char.save(); io.emit('character:update', { character: char.toObject() }); res.json({ character: char.toObject() }); }
	else { characters.set(char.id, char); io.emit('character:update', { character: char }); res.json({ character: char }); }
});

// -------------------- Dice: expression parser and sockets --------------------
const DICE_EXPR_RE = /^(\d+)?d(\d+)(k[hl](\d+))?(\s*[+-]\s*\d+)?$/i;
function rollDiceExpression(expr) {
	const m = String(expr || '').replace(/\s+/g,'').match(DICE_EXPR_RE);
	if (!m) return null;
	const count = Math.max(1, Number(m[1] || 1));
	const sides = Math.max(2, Number(m[2]));
	const keep = m[3] ? { mode: m[3][1], n: Number(m[4]) } : null;
	const mod = m[5] ? Number(m[5].replace(/\s/g,'')) : 0;
	const rolls = Array.from({ length: count }, () => rollDie(sides));
	let used = rolls.slice();
	if (keep) {
		used = [...rolls].sort((a,b)=> keep.mode==='h'? b-a : a-b).slice(0, Math.max(1, keep.n));
	}
	const sum = used.reduce((a,b)=>a+b,0) + mod;
	return { expr, sides, count, rolls, used, mod, total: sum };
}

// Socket.IO auth from cookie sid
io.use(async (socket, next) => {
	try {
		const cookieHeader = socket.handshake.headers.cookie || '';
		const cookies = Object.fromEntries(cookieHeader.split(';').filter(Boolean).map(p => {
			const [k, v] = p.trim().split('=');
			return [decodeURIComponent(k), decodeURIComponent(v || '')];
		}));
		const sid = cookies.sid;
		if (!sid) return next(new Error('no sid'));
		const sess = sessions.get(sid);
		if (!sess) return next(new Error('bad sid'));
		socket.data.session = sess;
		
		// Load user data from database or memory
		let user = null;
		if (useMongo) {
			user = await DB.User.findOne({ userId: sess.userId }).lean();
		} else {
			user = users.get(sess.userId);
			// If user not in memory, try to recreate from session
			if (!user) {
				user = { userId: sess.userId, name: 'Unknown', role: sess.role };
				users.set(sess.userId, user);
			}
		}
		
		if (!user) return next(new Error('user not found'));
		socket.data.user = user;
		return next();
	} catch (e) {
		return next(e);
	}
});

// Dice helpers
const ALLOWED_DICE = [4,5,6,8,10,12,14,15,16,18,20];
function rollDie(sides) {
	return 1 + Math.floor(Math.random() * sides);
}
function rollWithAdvantage(sides, mode) {
	const a = rollDie(sides);
	const b = rollDie(sides);
	if (mode === 'adv') return Math.max(a, b);
	if (mode === 'dis') return Math.min(a, b);
	return a; // normal
}

// Simple loot generator based on character stats and tier
function generateLoot(character, { tier = 1 } = {}) {
	loadUnifiedRules();
	const luck = Number(character?.special?.L || 5);
	const luckMod = luck - 5;
	const baseCaps = 5 * tier + Math.max(0, luckMod) * 2;
	const capsRoll = 1 + Math.floor(Math.random() * (6 * tier));
	const caps = baseCaps + capsRoll;
	// Pick up to N small items from items.json Other Equipment and some Food
	const itemsPool = [];
	const other = RULES_CACHE?.items?.['Other Equipment'] || [];
	const foods = RULES_CACHE?.items?.['Food and Drinks']?.['Pre-Made Food'] || [];
	for (const it of other) itemsPool.push(it.name);
	for (const it of foods) itemsPool.push(it.name);
	const count = Math.min(3, 1 + Math.max(0, Math.floor(luckMod / 2)));
	const items = [];
	for (let i=0; i<count && itemsPool.length>0; i++) {
		const idx = Math.floor(Math.random() * itemsPool.length);
		items.push(itemsPool[idx]);
	}
	return { caps, items, rolls: [capsRoll], used: [capsRoll] };
}

io.on('connection', (socket) => {
	const sess = socket.data.session;
	const user = socket.data.user;

	// Join room per userId to allow targeted emits
	socket.join(user.userId);

	socket.on('characters:request', async () => {
		const sendList = (chars) => {
			loadUnifiedRules();
			const withDer = (chars || []).map(c => withDerivedPersisted({ ...c }));
			const withOwners = withDer.map(c => {
				const owner = useMongo ? null : users.get(c.ownerId);
				return { ...c, ownerName: owner?.name || c.ownerName || 'Unknown' };
			});
			let out = withDer;
			if (sess.role === 'player') {
				out = withOwners.map(c => (c.ownerId === sess.userId ? c : { id: c.id, name: c.name, ownerId: c.ownerId, ownerName: c.ownerName }));
			}
			socket.emit('characters:list', { characters: sess.role === 'dm' ? withOwners : out });
		};
		if (useMongo) {
			const chars = await DB.Character.find({}).lean();
			sendList(chars);
		} else {
			sendList(Array.from(characters.values()));
		}
	});

	// Shop updates live request
	socket.on('shop:request', () => {
		if (useMongo) {
			DB.ShopItem.find({}).lean().then(items => socket.emit('shop:update', { items }));
		} else {
			socket.emit('shop:update', { items: Array.from(shopItems.values()) });
		}
	});

	// Player or DM updates own character fields (server also has REST for this)
	socket.on('character:update', ({ id, updates }) => {
		const char = characters.get(id);
		if (!char) return;
		const isOwner = char.ownerId === sess.userId;
		const isDm = sess.role === 'dm';
		if (!isOwner && !isDm) return;
		const { name, xp, hp, maxHp, caps, inventory } = updates || {};
		if (typeof name === 'string') char.name = name;
		if (Number.isFinite(xp)) char.xp = xp;
		if (Number.isFinite(hp)) char.hp = Math.max(0, Math.min(maxHp ?? char.maxHp, hp));
		if (Number.isFinite(maxHp)) char.maxHp = maxHp;
		if (Number.isFinite(caps)) char.caps = caps;
		if (Array.isArray(inventory)) char.inventory = inventory.slice(0, 100);
		if (updates && typeof updates.equipment === 'object') char.equipment = { ...(char.equipment||{}), ...updates.equipment };
		if (updates && typeof updates.equipmentUpgrades === 'object') {
			// Enforce: only upgrades that exist in inventory (by name) are allowed
			const invNames = new Set((char.inventory||[]).map(x => String(x).toLowerCase()));
			const filtered = {};
			for (const [k,v] of Object.entries(updates.equipmentUpgrades)) {
				if (invNames.has(String(k).toLowerCase())) filtered[k] = Number(v)||1;
			}
			char.equipmentUpgrades = { ...(char.equipmentUpgrades||{}), ...filtered };
		}
		if (updates && typeof updates.skillsPoints === 'object') {
			// Enforce spend within allowance: cap total to totalSkillPointsGranted
			const next = { ...(char.skillsPoints||{}), ...updates.skillsPoints };
			const spent = Object.values(next).reduce((a,b)=>a+Number(b||0),0);
			const cap = Number(char.totalSkillPointsGranted||0);
			if (spent <= cap) {
				char.skillsPoints = next;
				char.unspentSkillPoints = Math.max(0, cap - spent);
			}
		}
		if (updates && typeof updates.deathSaves === 'object') char.deathSaves = { ...(char.deathSaves||{s:0,f:0}), ...updates.deathSaves };
		if (Array.isArray(updates?.conditions)) char.conditions = updates.conditions.slice(0, 20);
		withDerivedPersisted(char);
		ensureLevelProgression(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// DM specific: apply xp, damage, shop grant
	socket.on('dm:applyXp', ({ characterId, delta }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		char.xp = Math.max(0, (char.xp || 0) + (Number(delta) || 0));
		ensureLevelProgression(char);
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// Inventory actions
	socket.on('character:drop', ({ id, item }) => {
		const char = characters.get(id);
		if (!char) return;
		const isOwner = char.ownerId === sess.userId || sess.role === 'dm';
		if (!isOwner) return;
		const idx = (char.inventory||[]).findIndex(n => String(n).toLowerCase() === String(item||'').toLowerCase());
		if (idx >= 0) {
			char.inventory = [...char.inventory.slice(0, idx), ...char.inventory.slice(idx+1)];
			// Also remove from materials if it's a material item
			const materialName = String(item).toLowerCase();
			if (char.materials && char.materials[materialName]) {
				char.materials[materialName] = Math.max(0, char.materials[materialName] - 1);
				if (char.materials[materialName] === 0) {
					delete char.materials[materialName];
				}
			}
			withDerivedPersisted(char);
			characters.set(char.id, char);
			io.emit('character:update', { character: char });
		}
	});

	socket.on('character:useItem', ({ id, item }) => {
		// Minimal: consume item if present. Hook for effects can be added here.
		const char = characters.get(id);
		if (!char) return;
		const isOwner = char.ownerId === sess.userId || sess.role === 'dm';
		if (!isOwner) return;
		const idx = (char.inventory||[]).findIndex(n => String(n).toLowerCase() === String(item||'').toLowerCase());
		if (idx >= 0) {
			char.inventory = [...char.inventory.slice(0, idx), ...char.inventory.slice(idx+1)];
			withDerivedPersisted(char);
			characters.set(char.id, char);
			io.emit('character:update', { character: char });
		}
	});

	socket.on('character:equip', ({ id, item, slot }) => {
		const char = characters.get(id);
		if (!char) return;
		const isOwner = char.ownerId === sess.userId || sess.role === 'dm';
		if (!isOwner) return;
		char.equipment = { ...(char.equipment||{}) };
		const slotName = String(slot || '').trim() || 'Weapon 1';
		char.equipment[slotName] = String(item||'');
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// DM: simple loot roll
	socket.on('dm:lootRoll', ({ characterId, tier = 1 }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		loadUnifiedRules();
		const loot = generateLoot(char, { tier });
		char.caps = Number(char.caps || 0) + loot.caps;
		char.inventory = [...(char.inventory || []), ...loot.items];
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('loot:rolled', { characterName: char.name, tier, caps: loot.caps, items: loot.items });
		io.emit('character:update', { character: char });
	});

	// DM: advanced loot controls
	socket.on('dm:lootRollAdvanced', ({ characterId, tier = 1, categories = [], count = 1 }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		loadUnifiedRules();
		const pool = [];
		const itemsDoc = RULES_CACHE?.items || {};
		(function take(val, cat){
			if (Array.isArray(val)) {
				for (const it of val) { if (it && it.name) pool.push({ name: it.name, category: cat||'' }); }
			} else if (val && typeof val === 'object') {
				for (const [k,v] of Object.entries(val)) take(v, cat? `${cat} / ${k}` : k);
			}
		})(itemsDoc, '');
		const chosenCats = new Set((categories||[]).map(s=>String(s)));
		const catFiltered = chosenCats.size ? pool.filter(p => [...chosenCats].some(c=> p.category.includes(c))) : pool;
		const drops = [];
		for (let i=0;i<Math.max(1, Number(count)||1) && catFiltered.length>0;i++) {
			const idx = Math.floor(Math.random()*catFiltered.length);
			drops.push(catFiltered[idx].name);
		}
		const luck = Number(char?.special?.L || 5);
		const caps = (5 * tier) + Math.max(0, luck - 5) * 2 + Math.floor(Math.random()* (6 * tier));
		char.caps = Number(char.caps||0) + caps;
		char.inventory = [...(char.inventory||[]), ...drops];
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('loot:rolled', { characterName: char.name, tier, caps, items: drops });
		io.emit('character:update', { character: char });
	});

	socket.on('dm:applyDamage', ({ characterId, damage }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		const dmg = Number(damage) || 0;
		if (dmg > 0) {
			// Damage (positive damage reduces HP)
			char.hp = Math.max(0, char.hp - dmg);
		} else if (dmg < 0) {
			// Healing (negative damage heals HP - subtract negative to add)
			char.hp = Math.min(char.maxHp, char.hp - dmg);
		}
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	socket.on('dm:setShopAccess', ({ characterId, allow }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		char.shopAccess = !!allow;
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// DM dice roll broadcast with adv/dis
	socket.on('dm:rollDice', ({ sides, mode }) => {
		if (sess.role !== 'dm') return;
		const n = Number(sides);
		if (!ALLOWED_DICE.includes(n)) return;
		const result = rollWithAdvantage(n, mode);
		io.emit('dice:rolled', { by: user.name, sides: n, mode: mode || 'normal', result, ts: Date.now() });
	});
	// DM: skill check (group)
	socket.on('dm:skillCheck', ({ skill, dc = 10, characterIds = [], advantage = false, disadvantage = false }) => {
		if (sess.role !== 'dm') return;
		const results = [];
		for (const id of characterIds) {
			const ch = characters.get(id);
			if (!ch) continue;
			const bonus = computeSkillBonusFor(ch, skill);
			const a = 1 + Math.floor(Math.random() * 20);
			const b = 1 + Math.floor(Math.random() * 20);
			let roll = a;
			if (advantage) roll = Math.max(a,b);
			if (disadvantage) roll = Math.min(a,b);
			// Luck re-roll hook for Breach if desired by rules
			if (String(skill).toLowerCase() === 'breach') {
				const luckMod = Number((ch.special?.L || 5) - 5);
				if (luckMod > 0) roll = Math.max(roll, 1 + Math.floor(Math.random() * 20));
			}
			results.push({ id, name: ch.name, total: roll + bonus, roll, bonus, pass: (roll + bonus) >= dc });
		}
		io.emit('dice:rolled', { by: `DM ${user.name}`, expr: `${skill} vs DC ${dc}`, total: results.filter(r=>r.pass).length, rolls: results.map(r=>r.total), used: [], mod: 0, ts: Date.now() });
	});

	// General dice expression roller for any user
	socket.on('dice:roll', ({ expr, isPublic }) => {
		const out = rollDiceExpression(expr);
		if (!out) return;
		const payload = { by: user.name, expr: out.expr, total: out.total, rolls: out.rolls, used: out.used, mod: out.mod, ts: Date.now() };
		if (isPublic === false) {
			socket.emit('dice:rolled', payload);
		} else {
			io.emit('dice:rolled', payload);
		}
	});

	// DM: give caps quickly
	socket.on('dm:giveCaps', ({ characterId, delta }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		char.caps = Math.max(0, Number(char.caps || 0) + Number(delta || 0));
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// DM: give item
	socket.on('dm:giveItem', ({ characterId, itemName }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char || !itemName) return;
		char.inventory = [...(char.inventory || []), String(itemName)];
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// DM: loot roll (removed; using advanced only)

	// DM: conditions add/remove and death saves adjust
	socket.on('dm:setConditions', ({ characterId, conditions }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		if (Array.isArray(conditions)) char.conditions = conditions.slice(0,20);
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	socket.on('dm:setDeathSaves', ({ characterId, s, f }) => {
		if (sess.role !== 'dm') return;
		const char = characters.get(characterId);
		if (!char) return;
		char.deathSaves = { s: Math.max(0, Math.min(3, Number(s||0))), f: Math.max(0, Math.min(3, Number(f||0))) };
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// Enemies management
	socket.on('dm:enemiesSet', ({ enemies }) => {
		if (sess.role !== 'dm') return;
		// store global enemies list and broadcast
		combatState.enemies = (Array.isArray(enemies) ? enemies.slice(0, 50) : []).map((e, i) => ({ id: e.id || `e-${i}`, name: e.name, hp: Number(e.hp||1), maxHp: Number(e.maxHp||e.hp||1) }));
		io.emit('dm:enemies', { enemies: combatState.enemies });
	});

	// Start initiative order (simple ordering by provided array of IDs)
	socket.on('dm:initiativeSet', ({ order }) => {
		if (sess.role !== 'dm') return;
		combatState.initiative = Array.isArray(order) ? order.slice(0, 100) : [];
		io.emit('dm:initiative', { order: combatState.initiative });
	});

	// Target an enemy with an attack
	socket.on('attack:enemy', ({ attackerId, enemyId, toHit, damage }) => {
		const enemy = combatState.enemies.find(e => e.id === enemyId);
		const atk = characters.get(attackerId);
		if (!enemy || !atk) return;
		// Simple: hit if toHit >= 10 + enemyLevel? We'll use 10 baseline.
		const hit = Number(toHit||0) >= 10;
		if (hit) {
			const dealt = Math.max(0, Number(damage||0));
			enemy.hp = Math.max(0, enemy.hp - dealt);
			io.emit('dm:enemies', { enemies: combatState.enemies });
			io.emit('dice:rolled', { by: atk.name, expr: `Hit ${enemy.name}`, total: dealt, rolls: [Number(toHit||0)], used: [], mod: 0, ts: Date.now() });
		} else {
			io.emit('dice:rolled', { by: atk.name, expr: `Miss ${enemy.name}`, total: 0, rolls: [Number(toHit||0)], used: [], mod: 0, ts: Date.now() });
		}
	});

	// Enemy attack a character
	socket.on('enemy:attack', ({ enemyId, defenderId, toHit, damage, location }) => {
		const enemy = combatState.enemies.find(e => e.id === enemyId);
		const def = characters.get(defenderId);
		if (!enemy || !def) return;
		const hit = Number(toHit||0) >= Number(def.derived?.ac || 10);
		if (hit) {
			const dt = Number(def.derived?.dt || 0);
			const dealt = Math.max(0, Number(damage||0) - dt);
			def.hp = Math.max(0, def.hp - dealt);
			characters.set(def.id, def);
			io.emit('character:update', { character: def });
			io.emit('dice:rolled', { by: enemy.name, expr: `Hit ${def.name}`, total: dealt, rolls: [Number(toHit||0)], used: [], mod: 0, ts: Date.now(), note: `Loc ${location||'Body'}; DT ${dt}` });
		} else {
			io.emit('dice:rolled', { by: enemy.name, expr: `Miss ${def.name}`, total: 0, rolls: [Number(toHit||0)], used: [], mod: 0, ts: Date.now() });
		}
	});

	// Spend SPECIAL point
	socket.on('character:spendSpecial', ({ id, ability }) => {
		const char = characters.get(id);
		if (!char) return;
		const isOwner = char.ownerId === sess.userId || sess.role === 'dm';
		if (!isOwner) return;
		const left = Number(char.unspentSpecialPoints || 0);
		if (left <= 0) return;
		if (!'SPECI AL'.includes((ability||'')[0])) return;
		const key = ability[0].toUpperCase();
		char.special[key] = Math.min(10, Number(char.special[key] || 1) + 1);
		char.unspentSpecialPoints = left - 1;
		withDerivedPersisted(char);
		characters.set(char.id, char);
		io.emit('character:update', { character: char });
	});

	// Targeted attack: compute simple injury message
	socket.on('attack:targeted', ({ attackerId, defenderId, hitRoll, damage, location }) => {
		const atk = characters.get(attackerId);
		const def = characters.get(defenderId);
		if (!atk || !def) return;
		const dt = Number(def.derived?.dt || 0);
		const hpBefore = def.hp;
		// Better hit logic: AC vs to-hit, and rough range penalty using Perception (short/long from P)
		const toHit = Number(hitRoll||0);
		const targetAC = Number(def.derived?.ac || 10);
		if (toHit < targetAC) {
			io.emit('dice:rolled', { by: atk.name, expr: 'Targeted Attack (miss)', total: 0, rolls: [toHit], used: [], mod: 0, ts: Date.now(), note: `Need ${targetAC}+` });
			return;
		}
		const hpAfter = Math.max(0, hpBefore - Math.max(0, Number(damage||0) - dt));
		def.hp = hpAfter;
		let note = `${atk.name} hits ${def.name}'s ${location||'body'} for ${damage} (DT ${dt}) → ${hpAfter}/${def.maxHp}`;
		// crude injury tracking: if damage >= half maxHp or hp reaches 0
		if (damage >= Math.ceil(def.maxHp / 2)) note += ' • Severe Injury!';
		if (hpAfter === 0) note += ' • Dying!';
		characters.set(def.id, def);
		io.emit('character:update', { character: def });
		io.emit('dice:rolled', { by: atk.name, expr: 'Targeted Attack', total: damage, rolls: [Number(hitRoll||0)], used: [], mod: 0, ts: Date.now(), note });
	});

	socket.on('disconnect', () => {
		// no-op for now
	});
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});