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
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- Rules Cache --------------------
let RULES_CACHE = null;
let ITEM_WEIGHT_INDEX = null;

function readJsonSafe(relPath) {
    try {
        const p = path.join(__dirname, 'public', relPath);
        if (!fs.existsSync(p)) throw new Error(`File ${relPath} not found`);
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
    const items = readJsonSafe('items.json');
    const perksRaw = readJsonSafe('perks.json');
    const racesDoc = readJsonSafe('character_creation_leveling_races.json');
    const condLoot = readJsonSafe('conditions_and_loot_gm_section.json');
    const races = Array.isArray(racesDoc?.races) ? racesDoc.races : [
        { name: 'Human' }, { name: 'Ghoul' }, { name: 'Super Mutant' }, { name: 'Synth' }
    ];
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
        skills: (ability?.SkillChecks?.SkillsList || []).map(s => ({
            name: s.Name,
            baseFormula: s.PrimaryAbility.includes(' or ')
                ? `Math.max(${s.PrimaryAbility.split(' or ').map(p => `${p[0]} - 5`).join(', ')}) + (L - 5)`
                : `(${s.PrimaryAbility[0]} - 5) + (L - 5)`
        })),
        races,
        backgrounds: Array.isArray(backgrounds?.Backgrounds) ? backgrounds.Backgrounds : [],
        perks,
        items: items || {},
        conditions: Array.isArray(condLoot?.ConditionsAndLoot?.Conditions) ? condLoot.ConditionsAndLoot.Conditions : []
    };
    RULES_CACHE = rules;
    ITEM_WEIGHT_INDEX = buildItemWeightIndex(items || {});
    return rules;
}

app.get('/rules.json', (req, res) => {
    try {
        res.json(loadUnifiedRules());
    } catch (e) {
        console.error(`Error serving /rules.json: ${e.message}`);
        res.status(500).json({ error: 'Failed to load rules' });
    }
});

app.get('/api/item-categories', (req, res) => {
    try {
        const items = readJsonSafe('items.json');
        res.json({ categories: generateItemCategories(items || {}) });
    } catch (e) {
        console.error(`Error serving /api/item-categories: ${e.message}`);
        res.status(500).json({ error: 'Failed to load categories' });
    }
});

app.get('/api/perks', (req, res) => {
    try {
        loadUnifiedRules();
        res.json({ perks: RULES_CACHE.perks || [] });
    } catch (e) {
        console.error(`Error serving /api/perks: ${e.message}`);
        res.status(500).json({ error: 'Failed to load perks' });
    }
});

// -------------------- Derived Stats --------------------
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
    } catch (e) {
        console.error(`Error computing derived stats: ${e.message}`);
    }
    return { maxHp, ap, sp, carryMax, carryCurrent, luckMod: (L - 5), ac, dt };
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
        role: { type: String, enum: ['player', 'dm'] },
        lastLoginAt: Date, // Timestamp of last login
        lastLoginIp: String, // IP address
        userAgent: String,  // Browser/Device info
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
        inventory: { type: [String], default: [] },
        materials: { type: Map, of: Number, default: {} },
        equipment: { type: Map, of: String, default: {} },
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

// In-memory fallback
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
            const char = await global.DB.Character.findOne({ id: charId }).lean();
            console.log(`Fetched character ${charId}: ${char ? 'Found' : 'Not found'}`);
            return char;
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
                console.log(`Updated character ${char.id}`);
            } else {
                await global.DB.Character.create(char);
                console.log(`Created character ${char.id}`);
            }
            return await global.DB.Character.findOne({ id: char.id }).lean();
        } else {
            characters.set(char.id, char);
            console.log(`Saved character ${char.id} in-memory`);
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
            const user = await global.DB.User.findOne({ userId }).lean();
            console.log(`Fetched user ${userId}: ${user ? 'Found' : 'Not found'}`);
            return user;
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
    if (!cleanName) return res.status(400).json({ error: 'Invalid name' });
    const hasDmToken = /(^dm:)|(#dm\b)|(\[dm\])/i.test(cleanName);
    if (hasDmToken) cleanName = cleanName.replace(/(^dm:)|(#dm\b)|(\[dm\])/ig, '').trim();
    if (dmKey && String(dmKey) === String(process.env.DM_KEY || 'letmein')) reqRole = 'dm';
    if (hasDmToken) reqRole = 'dm';
    if (!reqRole || !['player', 'dm'].includes(reqRole)) return res.status(400).json({ error: 'Invalid role' });
    try {
        let existing = null;
        if (useMongo) {
            existing = await global.DB.User.findOne({ name: cleanName, role: reqRole }).lean();
            if (!existing) {
                const userId = (reqRole === 'dm' ? 'dm-' : 'p-') + uuidv4();
                await global.DB.User.create({ userId, name: cleanName, role: reqRole });
                existing = { userId, name: cleanName, role: reqRole };
                console.log(`Created user ${userId}: ${cleanName} (${reqRole})`);
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
        res.json({ user: existing });
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
    const user = await getUser(s.userId);
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
        console.log(`Sent characters list to ${s.userId}: ${out.length} characters`);
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
        const ch = useMongo ? await global.DB.Character.findOne({ ownerId: s.userId }).lean() : Array.from(characters.values()).find(c => c.ownerId === s.userId);
        console.log(`Sent my character to ${s.userId}: ${ch ? ch.id : 'None'}`);
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
            level: 1, xp: 0, hp: maxHp, maxHp, caps: 0, inventory: [], materials: {}, equipment: {}, conditions: [], shopAccess: false
        };
        doc.ownerName = (await getUser(ownerId))?.name || 'Unknown';
        doc = withDerivedPersisted(doc);
        await saveCharacter(doc);
        io.emit('character:update', { character: doc });
        console.log(`Created character ${id} for user ${ownerId}`);
        res.json({ character: doc });
    } catch (e) {
        console.error(`Error creating character: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/characters/:id/materials', async (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    if (s.role !== 'dm') return res.status(403).json({ error: 'DM only' });
    try {
        let char = await getCharacter(req.params.id);
        if (!char) return res.status(404).json({ error: 'Character not found' });
        const { add = {} } = req.body || {};
        char.materials = { ...char.materials };
        for (const [mat, qty] of Object.entries(add)) {
            if (typeof mat === 'string' && Number.isFinite(Number(qty))) {
                char.materials[mat.toLowerCase()] = (Number(char.materials[mat.toLowerCase()] || 0) + Number(qty)) || 0;
            }
        }
        withDerivedPersisted(char);
        char = await saveCharacter(char);
        io.emit('character:update', { character: char });
        console.log(`Added materials ${JSON.stringify(add)} to character ${req.params.id}`);
        res.json({ character: char });
    } catch (e) {
        console.error(`Error updating materials for character ${req.params.id}: ${e.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/shop', async (req, res) => {
    try {
        const items = useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
        console.log(`Sent shop items: ${items.length} items`);
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
        io.emit('shop:update', { items: useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values()) });
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
        const cookies = Object.fromEntries((socket.handshake.headers.cookie || '').split(';').filter(Boolean).map(p => {
            const [k, v] = p.trim().split('=');
            return [decodeURIComponent(k), decodeURIComponent(v || '')];
        }));
        const sid = cookies.sid;
        if (!sid) throw new Error('No session ID');
        const sess = sessions.get(sid);
        if (!sess) throw new Error('Invalid session ID');
        socket.data.session = sess;
        let user = await getUser(sess.userId);
        if (!user) {
            user = { userId: sess.userId, name: 'Unknown', role: sess.role };
            if (!useMongo) users.set(sess.userId, user);
        }
        socket.data.user = user;
        console.log(`Socket connected for user ${user.userId} (${user.role})`);
        next();
    } catch (e) {
        console.error(`Socket auth error: ${e.message}`);
        next(e);
    }
});

io.on('connection', (socket) => {
    const sess = socket.data.session;
    const user = socket.data.user;
    socket.join(user.userId);

    socket.on('characters:request', async () => {
        try {
            let list = useMongo ? await global.DB.Character.find({}).lean() : Array.from(characters.values());
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
            console.log(`Sent characters list to ${user.userId}: ${out.length} characters`);
        } catch (e) {
            console.error(`Error handling characters:request: ${e.message}`);
            socket.emit('error', { message: 'Failed to fetch characters' });
        }
    });

    socket.on('shop:request', async () => {
        try {
            const items = useMongo ? await global.DB.ShopItem.find({}).lean() : Array.from(shopItems.values());
            socket.emit('shop:update', { items });
            console.log(`Sent shop items to ${user.userId}: ${items.length} items`);
        } catch (e) {
            console.error(`Error handling shop:request: ${e.message}`);
            socket.emit('error', { message: 'Failed to fetch shop items' });
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
            console.log(`Equipped ${item || 'nothing'} to slot ${slot || 'Weapon 1'} for character ${id}`);
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

    socket.on('dm:giveXP', async ({ characterId, xp }) => {
        if (sess.role !== 'dm') return socket.emit('error', { message: 'DM only' });
        try {
            let char = await getCharacter(characterId);
            if (!char) return socket.emit('error', { message: 'Character not found' });
            const xpAdd = Number(xp) || 0;
            if (xpAdd >= 0) {
                char.xp = (char.xp || 0) + xpAdd;
            }
            withDerivedPersisted(char);
            char = await saveCharacter(char);
            io.emit('character:update', { character: char });
            console.log(`Added ${xp} XP to character ${characterId}, new XP: ${char.xp}`);
        } catch (e) {
            console.error(`Error in dm:giveXP for ${characterId}: ${e.message}`);
            socket.emit('error', { message: 'Failed to give XP' });
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

    socket.on('dm:rollDice', ({ sides }) => {
        if (sess.role !== 'dm') return socket.emit('error', { message: 'DM only' });
        const n = Number(sides);
        if (![4, 6, 8, 10, 12, 20].includes(n)) return socket.emit('error', { message: 'Invalid dice size' });
        const result = 1 + Math.floor(Math.random() * n);
        io.emit('dice:rolled', { by: user.name, sides: n, result, ts: Date.now() });
        console.log(`DM ${user.name} rolled d${n}: ${result}`);
    });
});

// -------------------- Start Server --------------------
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
