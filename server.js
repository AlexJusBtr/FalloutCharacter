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
        console.error(`Failed to read JSON ${relPath}: ${e.message}`);
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

function generateItemCategories(itemsDoc) {
    const categories = new Set();
    if (!itemsDoc || typeof itemsDoc !== 'object') return [];
    function scan(val, parent = '') {
        if (Array.isArray(val)) {
            if (parent) categories.add(parent);
        } else if (val && typeof val === 'object') {
            for (const [k, v] of Object.entries(val)) {
                const path = parent ? `${parent} / ${k}` : k;
                scan(v, path);
            }
        }
    }
    scan(itemsDoc);
    return Array.from(categories).sort();
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
    const skills = (ability?.SkillChecks?.SkillsList || []).map(s => ({
        name: s.Name,
        baseFormula: s.PrimaryAbility.includes(' or ')
            ? `Math.max(${s.PrimaryAbility.split(' or ').map(p => `${p[0]} - 5`).join(', ')}) + (L - 5)`
            : `(${s.PrimaryAbility[0]} - 5) + (L - 5)`
    }));
    const traits = Array.isArray(backgrounds?.Traits) ? backgrounds.Traits : (Array.isArray(traitsRaw?.traits) ? traitsRaw.traits : []);
    const perks = Array.isArray(perksRaw?.Perks) ? perksRaw.Perks : [];
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
        races,
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
        console.error(`Error serving /rules.json: ${e.message}`);
        res.status(500).json({ error: 'Failed to load rules' });
    }
});

app.get('/api/item-categories', (req, res) => {
    try {
        const items = readJsonSafe('items.json');
        const categories = generateItemCategories(items || {});
        res.json({ categories });
    } catch (e) {
        console.error(`Error serving /api/item-categories: ${e.message}`);
        res.status(500).json({ error: 'Failed to load categories' });
    }
});

// -------------------- Derived stat helpers --------------------
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
    let ac = 10;
    let dt = 0;
    let radiationDc = Math.max(0, 12 - (E - 5));
    try {
        const eq = character?.equipment ? Object.values(character.equipment) : [];
        const armors = (RULES_CACHE?.items?.Armor || []);
        const weapons = (RULES_CACHE?.items?.Weapons || []).flatMap(cat => Object.values(cat));
        for (const slotItem of eq) {
            const a = armors.find(x => String(x.name).toLowerCase() === String(slotItem || '').toLowerCase());
            const w = weapons.find(x => String(x.name).toLowerCase() === String(slotItem || '').toLowerCase());
            if (a) {
                ac += Number(a.armor_class || 0) - 10;
                dt += Number(a.damage_threshold || 0);
            }
            if (w) {
                ac += Number(w.armor_class || 0);
                dt += Number(w.damage_threshold || 0);
            }
        }
        const armorUp = (RULES_CACHE?.items?.['Armor Upgrades'] || []);
        const upsRaw = character?.equipmentUpgrades || {};
        const upsList = Object.entries(upsRaw).map(([k, v]) => [k, Number(v) || 1]);
        for (const [upName, rankVal] of upsList) {
            const up = armorUp.find(u => String(u.name).toLowerCase() === String(upName).toLowerCase());
            const r = Number(rankVal || 1);
            if (!up || r <= 0) continue;
            if (up.name === 'Reinforced') dt += r;
            if (up.name === 'Hardened') ac += r;
            if (up.name === 'Lead Lined') radiationDc = Math.max(0, radiationDc - 2 * r);
            if (up.name === 'Sturdy') {
                character.derived = character.derived || {};
                character.derived.sturdyIgnoreLevels = Math.max(Number(character.derived.sturdyIgnoreLevels || 0), r === 1 ? 2 : (r === 2 ? 4 : 4));
                character.derived.armorNoCritDecay = character.derived.armorNoCritDecay || (r === 3);
            }
        }
    } catch (e) {
        console.error(`Error computing derived stats: ${e.message}`);
    }
    return { maxHp, ap, sp, carryMax, carryCurrent, luckMod: (L - 5), ac, dt, radiationDc };
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

function withDerivedPersisted(char) {
    const d = computeDerived(char);
    char.maxHp = d.maxHp;
    char.hp = Math.min(char.hp || d.maxHp, d.maxHp);
    char.derived = d;
    return char;
}

// -------------------- MongoDB Setup --------------------
const useMongo = !!process.env.MONGO_URL;
if (useMongo) {
    mongoose.connect(process.env.MONGO_URL, { autoIndex: true })
        .then(() => console.log('MongoDB connected'))
        .catch(e => console.error('MongoDB connect error', e));
    const userSchema = new mongoose.Schema({
        userId: { type: String, unique: true },
        name: String,
        role: { type: String, enum: ['player', 'dm'] }
    }, { timestamps: true });
    const characterSchema = new mongoose.Schema({
        id: { type: String, unique: true },
        name: String,
        ownerId: String,
        ownerName: String,
        ruleSet: { type: String, default: 'fallout' },
        race: String,
        background: String,
        trait: String,
        special: { S: Number, P: Number, E: Number, C: Number, I: Number, A: Number, L: Number },
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
        shopAccess: { type: Boolean, default: false }
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
const sessions = new Map();
const users = new Map();
const characters = new Map();
const shopItems = new Map();

function getSession(req) {
    const sid = req.cookies.sid;
    return sid ? sessions.get(sid) || null : null;
}

async function getCharacter(charId) {
    try {
        if (useMongo) {
            return await global.DB.Character.findOne({ id: charId }).lean();
        }
        return characters.get(charId) || null;
    } catch (e) {
        console.error(`Error fetching character ${charId}: ${e.message}`);
        return null;
    }
}

async function saveCharacter(char) {
    try {
        if (useMongo) {
            const existing = await global.DB.Character.findOne({ id: char.id });
            if (existing) {
                await global.DB.Character.updateOne({ id: char.id }, char);
                return await global.DB.Character.findOne({ id: char.id }).lean();
            } else {
                await global.DB.Character.create(char);
                return char;
            }
        } else {
            characters.set(char.id, char);
            return char;
        }
    } catch (e) {
        console.error(`Error saving character ${char.id}: ${e.message}`);
        throw e;
    }
}

async function getUser(userId) {
    try {
        if (useMongo) {
            return await global.DB.User.findOne({ userId }).lean();
        }
        return users.get(userId) || null;
    } catch (e) {
        console.error(`Error fetching user ${userId}: ${e.message}`);
        return null;
    }
}

// -------------------- Routes --------------------
app.post('/api/login', async (req, res) => {
    const { name, role, dmKey } = req.body || {};
    let reqRole = role;
    let cleanName = String(name || '').trim();
    if (typeof cleanName !== 'string' || !cleanName) {
        return res.status(400).json({ error: 'Invalid name or role' });
    }
    const hasDmToken = /(^dm:)|(#dm\b)|(\[dm\])/i.test(cleanName);
    if (hasDmToken) cleanName = cleanName.replace(/(^dm:)|(#dm\b)|(\[dm\])/ig, '').trim();
    if (dmKey && String(dmKey) === String(process.env.DM_KEY || 'letmein')) reqRole = 'dm';
    if (hasDmToken) reqRole = 'dm';
    if (!reqRole || !['player', 'dm'].includes(reqRole)) {
        return res.status(400).json({ error: 'Invalid name or role' });
    }
    try {
        let existing = null;
        if (useMongo) {
            existing = await global.DB.User.findOne({ name: cleanName, role: reqRole }).lean();
            if (!existing) {
                const userId = (reqRole === 'dm' ? 'dm-' : 'p-') + uuidv4();
                await global.DB.User.create({ userId, name: cleanName, role: reqRole });
                existing = { userId, name: cleanName, role: reqRole };
            }
        } else {
            for (const u of users.values()) {
                if (u.name === cleanName && u.role === reqRole) {
                    existing = u;
                    break;
                }
            }
            if (!existing) {
                const userId = (reqRole === 'dm' ? 'dm-' : 'p-') + uuidv4();
                existing = { userId, name: cleanName, role: reqRole };
                users.set(userId, existing);
            }
        }
        const sid = uuidv4();
        sessions.set(sid, { userId: existing.userId, role: existing.role });
        res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
        return res.json({ user: existing });
    } catch (e) {
        console.error(`Login error: ${e.message}`);
        res.status(500).json({ error: 'Server error during login' });
    }
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
    let user = await getUser(s.userId);
    res.json({ user });
});

app.get('/api/characters', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    try {
        let list = useMongo ? await global.DB.Character.find({}).lean() : Array.from(characters.values());
        loadUnifiedRules();
        const withDer = list.map(c => withDerivedPersisted({ ...c }));
        const withOwners = await Promise.all(withDer.map(async c => ({
            ...c,
            ownerName: (await getUser(c.ownerId))?.name || c.ownerName || 'Unknown'
        })));
        let out = withOwners;
        if (s.role === 'player') {
            out = withOwners.map(c => c.ownerId === s.userId ? c : { id: c.id, name: c.name, ownerId: c.ownerId, ownerName: c.ownerName });
        }
        res.json({ characters: out });
    } catch (e) {
        console.error(`Error fetching characters: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch characters' });
    }
});

app.get('/api/my/character', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    if (s.role !== 'player') return res.status(400).json({ error: 'Only players have a personal character' });
    try {
        let ch = useMongo ? await global.DB.Character.findOne({ ownerId: s.userId }).lean() : Array.from(characters.values()).find(c => c.ownerId === s.userId);
        res.json({ character: ch || null });
    } catch (e) {
        console.error(`Error fetching my character: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/character', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    if (s.role !== 'player' && s.role !== 'dm') return res.status(403).json({ error: 'Forbidden' });
    const ownerId = req.body.ownerId && s.role === 'dm' ? req.body.ownerId : s.userId;
    try {
        let existing = useMongo ? await global.DB.Character.findOne({ ownerId }).lean() : Array.from(characters.values()).find(c => c.ownerId === ownerId);
        if (existing) return res.status(400).json({ error: 'Character already exists for this player' });
        const id = 'c-' + uuidv4();
        const { name, race, background, trait, special = {}, perks = [] } = req.body || {};
        if (!name) return res.status(400).json({ error: 'Name required' });
        const safeSPECIAL = {
            S: Number(special.S || 1), P: Number(special.P || 1), E: Number(special.E || 1),
            C: Number(special.C || 1), I: Number(special.I || 1), A: Number(special.A || 1), L: Number(special.L || 1)
        };
        loadUnifiedRules();
        const maxHp = Math.max(1, 10 + (Number(safeSPECIAL.E || 1) - 5));
        let doc = {
            id, name, ownerId, race: race || '', background: background || '', trait: trait || '',
            special: safeSPECIAL, perks: Array.isArray(perks) ? perks.slice(0, 30) : [],
            level: 1, xp: 0, hp: maxHp, maxHp, caps: 0, inventory: [], materials: {}, equipment: {}, equipmentUpgrades: {}, conditions: [], shopAccess: false
        };
        doc.ownerName = (await getUser(ownerId))?.name || 'Unknown';
        doc = withDerivedPersisted(doc);
        await saveCharacter(doc);
        io.emit('character:update', { character: doc });
        res.json({ character: doc });
    } catch (e) {
        console.error(`Error creating character: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/characters/:id', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    try {
        let char = await getCharacter(req.params.id);
        if (!char) return res.status(404).json({ error: 'Not found' });
        const isOwner = char.ownerId === s.userId;
        const isDm = s.role === 'dm';
        if (!isOwner && !isDm) return res.status(403).json({ error: 'Forbidden' });
        const { name, hp, caps, inventory, conditions, equipment } = req.body || {};
        if (typeof name === 'string') char.name = name;
        if (Number.isFinite(hp)) char.hp = Math.max(0, Math.min(char.maxHp, hp));
        if (Number.isFinite(caps)) char.caps = caps;
        if (Array.isArray(inventory)) char.inventory = inventory.slice(0, 100);
        if (Array.isArray(conditions)) char.conditions = conditions.slice(0, 20);
        if (equipment && typeof equipment === 'object') char.equipment = { ...char.equipment, ...equipment };
        withDerivedPersisted(char);
        char = await saveCharacter(char);
        io.emit('character:update', { character: char });
        res.json({ character: char });
    } catch (e) {
        console.error(`Error updating character ${req.params.id}: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/characters/:id/shop', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
    try {
        let char = await getCharacter(req.params.id);
        if (!char) return res.status(404).json({ error: 'Not found' });
        const { allow } = req.body || {};
        char.shopAccess = !!allow;
        char = await saveCharacter(char);
        io.emit('character:update', { character: char });
        console.log(`Shop access set to ${allow} for character ${req.params.id}`);
        res.json({ character: char });
    } catch (e) {
        console.error(`Error setting shop access for character ${req.params.id}: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/shop', async (req, res) => {
    try {
        let items = useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
        res.json({ items });
    } catch (e) {
        console.error(`Error fetching shop items: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch shop items' });
    }
});

app.post('/api/shop/:id/buy', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    try {
        let char = useMongo ? await global.DB.Character.findOne({ ownerId: s.userId }) : Array.from(characters.values()).find(c => c.ownerId === s.userId);
        if (!char) return res.status(400).json({ error: 'No character' });
        if (!char.shopAccess && s.role !== 'dm') return res.status(403).json({ error: 'Shop access denied' });
        let item = useMongo ? await global.DB.ShopItem.findOne({ id: req.params.id }) : shopItems.get(req.params.id);
        if (!item) return res.status(404).json({ error: 'Item not found' });
        if (item.stock <= 0) return res.status(400).json({ error: 'Out of stock' });
        if (char.caps < item.cost) return res.status(400).json({ error: 'Not enough caps' });
        char.caps -= item.cost;
        char.inventory = [...(char.inventory || []), item.name];
        item.stock -= 1;
        if (useMongo) {
            await global.DB.Character.updateOne({ id: char.id }, char);
            await global.DB.ShopItem.updateOne({ id: item.id }, item);
        } else {
            characters.set(char.id, char);
            shopItems.set(item.id, item);
        }
        io.emit('character:update', { character: char });
        const list = useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
        io.emit('shop:update', { items: list });
        console.log(`Character ${char.id} bought ${item.name}`);
        res.json({ character: char, item });
    } catch (e) {
        console.error(`Error buying shop item ${req.params.id}: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

// -------------------- Socket.IO --------------------
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
        let user = await getUser(sess.userId);
        if (!user) {
            user = { userId: sess.userId, name: 'Unknown', role: sess.role };
            if (!useMongo) users.set(sess.userId, user);
        }
        socket.data.user = user;
        return next();
    } catch (e) {
        console.error(`Socket auth error: ${e.message}`);
        return next(e);
    }
});

io.on('connection', (socket) => {
    const sess = socket.data.session;
    const user = socket.data.user;
    socket.join(user.userId);

    socket.on('characters:request', async () => {
        try {
            const list = useMongo ? await global.DB.Character.find({}).lean() : Array.from(characters.values());
            loadUnifiedRules();
            const withDer = list.map(c => withDerivedPersisted({ ...c }));
            const withOwners = await Promise.all(withDer.map(async c => ({
                ...c,
                ownerName: (await getUser(c.ownerId))?.name || c.ownerName || 'Unknown'
            })));
            let out = withOwners;
            if (sess.role === 'player') {
                out = withOwners.map(c => c.ownerId === sess.userId ? c : { id: c.id, name: c.name, ownerId: c.ownerId, ownerName: c.ownerName });
            }
            socket.emit('characters:list', { characters: out });
        } catch (e) {
            console.error(`Error handling characters:request: ${e.message}`);
            socket.emit('error', { message: 'Failed to fetch characters' });
        }
    });

    socket.on('shop:request', async () => {
        try {
            const items = useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
            socket.emit('shop:update', { items });
        } catch (e) {
            console.error(`Error handling shop:request: ${e.message}`);
            socket.emit('error', { message: 'Failed to fetch shop items' });
        }
    });

    socket.on('character:update', async ({ id, updates }) => {
        try {
            let char = await getCharacter(id);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            const isOwner = char.ownerId === sess.userId;
            const isDm = sess.role === 'dm';
            if (!isOwner && !isDm) return socket.emit('error', { message: 'Forbidden' });
            const { name, hp, caps, inventory, conditions, equipment } = updates || {};
            if (typeof name === 'string') char.name = name;
            if (Number.isFinite(hp)) char.hp = Math.max(0, Math.min(char.maxHp, hp));
            if (Number.isFinite(caps)) char.caps = caps;
            if (Array.isArray(inventory)) char.inventory = inventory.slice(0, 100);
            if (Array.isArray(conditions)) char.conditions = conditions.slice(0, 20);
            if (equipment && typeof equipment === 'object') char.equipment = { ...char.equipment, ...equipment };
            withDerivedPersisted(char);
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Character ${id} updated: ${JSON.stringify({ name, hp, caps, inventory, conditions, equipment })}`);
        } catch (e) {
            console.error(`Error in character:update for ${id}: ${e.message}`);
            socket.emit('error', { message: 'Failed to update character' });
        }
    });

    socket.on('character:equip', async ({ id, item, slot }) => {
        try {
            let char = await getCharacter(id);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            const isOwner = char.ownerId === sess.userId || sess.role === 'dm';
            if (!isOwner) return socket.emit('error', { message: 'Forbidden' });
            loadUnifiedRules();
            const weapons = (RULES_CACHE?.items?.Weapons || []).flatMap(cat => Object.values(cat));
            const isValidWeapon = item ? weapons.some(w => String(w.name).toLowerCase() === String(item).toLowerCase()) : true;
            if (!isValidWeapon) return socket.emit('error', { message: `Invalid weapon: ${item}` });
            char.equipment = { ...char.equipment, [slot || 'Weapon 1']: String(item || '') };
            withDerivedPersisted(char);
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Equipped ${item} to slot ${slot || 'Weapon 1'} for character ${id}`);
        } catch (e) {
            console.error(`Error in character:equip for ${id}: ${e.message}`);
            socket.emit('error', { message: 'Failed to equip item' });
        }
    });

    socket.on('dm:applyDamage', async ({ characterId, damage }) => {
        if (sess.role !== 'dm') return socket.emit('error', { message: 'DM only' });
        try {
            let char = await getCharacter(characterId);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            const dmg = Number(damage) || 0;
            if (dmg !== 0) {
                char.hp = Math.max(0, Math.min(char.maxHp, char.hp - dmg));
            }
            withDerivedPersisted(char);
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Applied ${damage} damage to character ${characterId}, new HP: ${char.hp}`);
        } catch (e) {
            console.error(`Error in dm:applyDamage for ${characterId}: ${e.message}`);
            socket.emit('error', { message: 'Failed to apply damage' });
        }
    });

    socket.on('dm:setShopAccess', async ({ characterId, allow }) => {
        if (sess.role !== 'dm') return socket.emit('error', { message: 'DM only' });
        try {
            let char = await getCharacter(characterId);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            char.shopAccess = !!allow;
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Set shop access to ${allow} for character ${characterId}`);
        } catch (e) {
            console.error(`Error in dm:setShopAccess for ${characterId}: ${e.message}`);
            socket.emit('error', { message: 'Failed to set shop access' });
        }
    });

    socket.on('dm:setConditions', async ({ characterId, conditions }) => {
        if (sess.role !== 'dm') return socket.emit('error', { message: 'DM only' });
        try {
            let char = await getCharacter(characterId);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            if (!Array.isArray(conditions)) return socket.emit('error', { message: 'Invalid conditions format' });
            char.conditions = conditions.slice(0, 20).filter(c => typeof c === 'string');
            withDerivedPersisted(char);
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Set conditions ${conditions.join(', ')} for character ${characterId}`);
        } catch (e) {
            console.error(`Error in dm:setConditions for ${characterId}: ${e.message}`);
            socket.emit('error', { message: 'Failed to set conditions' });
        }
    });
});

// -------------------- Start Server --------------------
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
