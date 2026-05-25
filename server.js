require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client (bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use((req, res, next) => {
  if (req.path === '/api/upload/icon') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hivemind-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

async function getUser(id) {
  const { data } = await supabase.from('users').select('*').eq('id', id).single();
  return data;
}

async function getMembership(userId, projectId) {
  const { data } = await supabase.from('memberships').select('*')
    .eq('user_id', userId).eq('project_id', projectId).single();
  return data;
}

function getUserRolesFromMembership(membership, user) {
  if (user?.account_type === 'director') return ['director'];
  if (!membership) return [];
  return Array.isArray(membership.roles) ? membership.roles : [membership.role || 'viewer'];
}

async function getUserRoles(userId, projectId) {
  const user = await getUser(userId);
  if (user?.account_type === 'director') return ['director'];
  const m = await getMembership(userId, projectId);
  return getUserRolesFromMembership(m, user);
}

function isDirectorOrLead(roles) {
  return roles.some(r => r === 'director' || r.includes('lead') || r === 'project_manager');
}

function canEditDesign(roles) {
  return roles.some(r => r === 'director' || r.includes('lead') || r === 'designer' || r === 'project_manager');
}

async function logActivity(projectId, userId, entityId, action, detail) {
  const user = await getUser(userId);
  await supabase.from('activity').insert({
    id: uuidv4(), project_id: projectId, entity_id: entityId,
    user_id: userId, username: user?.username || 'Unknown',
    action, detail, created_at: new Date().toISOString()
  });
}

// ─── AUTH ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password, accountType } = req.body;
  if (!username || !password || !accountType) return res.status(400).json({ error: 'Missing fields' });
  const { data: existing } = await supabase.from('users').select('id').eq('username', username).single();
  if (existing) return res.status(400).json({ error: 'Username taken' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hash, account_type: accountType, created_at: new Date().toISOString() };
  const { error } = await supabase.from('users').insert(user);
  if (error) return res.status(500).json({ error: error.message });
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, accountType: user.account_type });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, accountType: user.account_type });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = await getUser(req.session.userId);
  if (!user) return res.json(null);
  res.json({ id: user.id, username: user.username, accountType: user.account_type });
});

app.get('/api/users', auth, async (req, res) => {
  const { data } = await supabase.from('users').select('id, username, account_type');
  res.json((data || []).map(u => ({ id: u.id, username: u.username, accountType: u.account_type })));
});

// ─── PROJECTS ─────────────────────────────────────────
function generateCode(name) {
  const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const DEFAULT_PIPELINE_TEMPLATES = [
  { name:'3D Prop Pipeline',       steps:[{id:'concept_art',name:'Concept Art',dept:'art'},{id:'modeling',name:'Modeling',dept:'art'},{id:'texturing',name:'Texturing',dept:'art'},{id:'rigging',name:'Rigging',dept:'art'},{id:'engine_import',name:'Engine Import',dept:'art'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'3D Character Pipeline',  steps:[{id:'concept_art',name:'Concept Art',dept:'art'},{id:'modeling',name:'Modeling',dept:'art'},{id:'rigging',name:'Rigging',dept:'art'},{id:'skinning',name:'Skinning',dept:'art'},{id:'texturing',name:'Texturing',dept:'art'},{id:'facial_setup',name:'Facial Setup',dept:'art'},{id:'engine_import',name:'Engine Import',dept:'art'},{id:'animation_setup',name:'Animation Setup',dept:'art'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'UI Asset Pipeline',      steps:[{id:'wireframe',name:'Wireframe',dept:'design'},{id:'design',name:'Design',dept:'art'},{id:'implementation',name:'Implementation',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'VFX Pipeline',           steps:[{id:'reference',name:'Reference Gathering',dept:'art'},{id:'blocking',name:'Blocking',dept:'art'},{id:'polish',name:'Polish',dept:'art'},{id:'engine_import',name:'Engine Import',dept:'art'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'Audio Asset Pipeline',   steps:[{id:'reference',name:'Reference Gathering',dept:'audio'},{id:'recording',name:'Recording',dept:'audio'},{id:'editing',name:'Editing',dept:'audio'},{id:'implementation',name:'Implementation',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'Gameplay Mechanic Pipeline', steps:[{id:'design_doc',name:'Design Doc',dept:'design'},{id:'prototype',name:'Prototype',dept:'programming'},{id:'implementation',name:'Implementation',dept:'programming'},{id:'balancing',name:'Balancing',dept:'design'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'Narrative Pipeline',     steps:[{id:'writing',name:'Writing',dept:'design'},{id:'review',name:'Review',dept:'design'},{id:'localization',name:'Localization',dept:'design'},{id:'implementation',name:'Implementation',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}] },
  { name:'Level Pipeline',         steps:[{id:'blockout',name:'Blockout',dept:'art'},{id:'art_pass',name:'Art Pass',dept:'art'},{id:'lighting',name:'Lighting',dept:'art'},{id:'optimization',name:'Optimization',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}] },
];


const DEFAULT_PIPELINES = {
  entity: [{id:'concept_art',name:'Concept Art',dept:'art'},{id:'mesh',name:'Mesh',dept:'art'},{id:'texture',name:'Texture',dept:'art'},{id:'icon',name:'Icon',dept:'art'},{id:'engine_import',name:'Engine Import',dept:'art'},{id:'implemented',name:'Implemented',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}],
  mechanic: [{id:'design_doc',name:'Design Doc',dept:'design'},{id:'prototype',name:'Prototype',dept:'programming'},{id:'animation',name:'Animation',dept:'art'},{id:'vfx',name:'VFX',dept:'art'},{id:'sound',name:'Sound',dept:'audio'},{id:'coded',name:'Coded',dept:'programming'},{id:'balanced',name:'Balanced',dept:'design'},{id:'qa',name:'QA',dept:'qa'}],
  system: [{id:'design_doc',name:'Design Doc',dept:'design'},{id:'prototype',name:'Prototype',dept:'programming'},{id:'implemented',name:'Implemented',dept:'programming'},{id:'balanced',name:'Balanced',dept:'design'},{id:'qa',name:'QA',dept:'qa'}],
  phenomenon: [{id:'concept_art',name:'Concept Art',dept:'art'},{id:'vfx_shader',name:'VFX/Shader',dept:'art'},{id:'implemented',name:'Implemented',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}],
  world: [{id:'design',name:'Design',dept:'design'},{id:'blockout',name:'Blockout',dept:'art'},{id:'art_pass',name:'Art Pass',dept:'art'},{id:'populated',name:'Populated',dept:'design'},{id:'optimized',name:'Optimized',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}],
  location: [{id:'design',name:'Design',dept:'design'},{id:'blockout',name:'Blockout',dept:'art'},{id:'art_pass',name:'Art Pass',dept:'art'},{id:'populated',name:'Populated',dept:'design'},{id:'optimized',name:'Optimized',dept:'programming'},{id:'qa',name:'QA',dept:'qa'}],
  concept: []
};

app.post('/api/projects', auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const user = await getUser(req.session.userId);
  if (user?.account_type !== 'director') return res.status(403).json({ error: 'Only directors can create projects' });
  const { data: projects } = await supabase.from('projects').select('invite_code');
  let code = generateCode(name);
  while (projects?.find(p => p.invite_code === code)) code = generateCode(name);
  const project = {
    id: uuidv4(), name, invite_code: code, owner_id: req.session.userId,
    created_at: new Date().toISOString(),
    departments: ['design','art','programming','production','qa','audio'],
    roles: ['lead_designer','designer','lead_artist','character_artist','prop_artist','environment_artist','concept_artist','animator','vfx_artist','ui_artist','tech_artist','lead_developer','developer','project_manager','qa_lead','qa_tester','audio_lead','audio_designer','viewer'],
    pipelines: DEFAULT_PIPELINES
  };
  const { error } = await supabase.from('projects').insert(project);
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('memberships').insert({ id: uuidv4(), user_id: req.session.userId, project_id: project.id, role: 'director', roles: ['director'], department: null, joined_at: new Date().toISOString() });
  res.json({ ...project, inviteCode: project.invite_code, ownerId: project.owner_id });
});

app.get('/api/projects', auth, async (req, res) => {
  const { data: memberships } = await supabase.from('memberships').select('*').eq('user_id', req.session.userId);
  if (!memberships?.length) return res.json([]);
  const ids = memberships.map(m => m.project_id);
  const { data: projects } = await supabase.from('projects').select('*').in('id', ids);
  res.json((projects || []).map(p => ({ ...p, inviteCode: p.invite_code, ownerId: p.owner_id, membership: memberships.find(m => m.project_id === p.id) })));
});

app.get('/api/projects/:id', auth, async (req, res) => {
  const { data } = await supabase.from('projects').select('*').eq('id', req.params.id).single();
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ ...data, inviteCode: data.invite_code, ownerId: data.owner_id });
});

app.put('/api/projects/:id', auth, async (req, res) => {
  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', req.params.id).single();
  if (project?.owner_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  const updates = {};
  if (req.body.inviteCode) updates.invite_code = req.body.inviteCode;
  if (req.body.name) updates.name = req.body.name;
  if (req.body.pipelines) updates.pipelines = req.body.pipelines;
  if (req.body.roles) updates.roles = req.body.roles;
  if (req.body.departments) updates.departments = req.body.departments;
  if (req.body.permissions) updates.permissions = req.body.permissions;
  const { data, error } = await supabase.from('projects').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, inviteCode: data.invite_code, ownerId: data.owner_id });
});

app.post('/api/projects/join', auth, async (req, res) => {
  const { code } = req.body;
  const { data: project } = await supabase.from('projects').select('*').eq('invite_code', code?.toUpperCase()).single();
  if (!project) return res.status(404).json({ error: 'Invalid invite code' });
  const { data: existing } = await supabase.from('memberships').select('id').eq('user_id', req.session.userId).eq('project_id', project.id).single();
  if (existing) return res.status(400).json({ error: 'Already a member' });
  await supabase.from('memberships').insert({ id: uuidv4(), user_id: req.session.userId, project_id: project.id, role: 'pending', roles: ['viewer'], department: null, joined_at: new Date().toISOString() });
  res.json({ project: { ...project, inviteCode: project.invite_code }, membership: { role: 'pending' } });
});

// ─── TEAM ─────────────────────────────────────────────
app.get('/api/projects/:id/members', auth, async (req, res) => {
  const { data: memberships } = await supabase.from('memberships').select('*').eq('project_id', req.params.id);
  if (!memberships?.length) return res.json([]);
  const userIds = memberships.map(m => m.user_id);
  const { data: users } = await supabase.from('users').select('id, username, account_type').in('id', userIds);
  res.json(memberships.map(m => {
    const user = users?.find(u => u.id === m.user_id);
    return { ...m, userId: m.user_id, username: user?.username || 'Unknown', accountType: user?.account_type };
  }));
});

app.put('/api/projects/:id/members/:userId', auth, async (req, res) => {
  const updates = {};
  if (req.body.role) { updates.role = req.body.role; updates.roles = [req.body.role]; }
  if (req.body.roles) updates.roles = req.body.roles;
  if (req.body.department !== undefined) updates.department = req.body.department;
  const { data, error } = await supabase.from('memberships').update(updates).eq('user_id', req.params.userId).eq('project_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/projects/:id/members/:userId', auth, async (req, res) => {
  await supabase.from('memberships').delete().eq('user_id', req.params.userId).eq('project_id', req.params.id);
  res.json({ ok: true });
});

// ─── PIPELINE TEMPLATES (stored in projects.pipelines.templates) ──────────
async function getProjectPipelines(pid) {
  const { data } = await supabase.from('projects').select('pipelines').eq('id', pid).single();
  return data?.pipelines || {};
}
async function saveProjectPipelines(pid, pipelines) {
  return supabase.from('projects').update({ pipelines }).eq('id', pid);
}

app.get('/api/projects/:pid/pipeline-templates', auth, async (req, res) => {
  const pipelines = await getProjectPipelines(req.params.pid);
  let templates = pipelines.templates;
  if (!templates || templates.length === 0) {
    // Seed defaults on first access
    templates = DEFAULT_PIPELINE_TEMPLATES.map(t => ({ ...t, id: uuidv4(), created_at: new Date().toISOString() }));
    await saveProjectPipelines(req.params.pid, { ...pipelines, templates });
  }
  res.json(templates);
});

app.post('/api/projects/:pid/pipeline-templates', auth, async (req, res) => {
  const pipelines = await getProjectPipelines(req.params.pid);
  const tpl = { id: uuidv4(), name: req.body.name, steps: req.body.steps || [], created_at: new Date().toISOString() };
  const templates = [...(pipelines.templates || []), tpl];
  const { error } = await saveProjectPipelines(req.params.pid, { ...pipelines, templates });
  if (error) return res.status(500).json({ error: error.message });
  res.json(tpl);
});

app.put('/api/projects/:pid/pipeline-templates/:id', auth, async (req, res) => {
  const pipelines = await getProjectPipelines(req.params.pid);
  let updated = null;
  const templates = (pipelines.templates || []).map(t => {
    if (t.id !== req.params.id) return t;
    updated = { ...t, ...(req.body.name !== undefined ? { name: req.body.name } : {}), ...(req.body.steps !== undefined ? { steps: req.body.steps } : {}) };
    return updated;
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  const { error } = await saveProjectPipelines(req.params.pid, { ...pipelines, templates });
  if (error) return res.status(500).json({ error: error.message });
  res.json(updated);
});

app.delete('/api/projects/:pid/pipeline-templates/:id', auth, async (req, res) => {
  const pipelines = await getProjectPipelines(req.params.pid);
  const templates = (pipelines.templates || []).filter(t => t.id !== req.params.id);
  const { error } = await saveProjectPipelines(req.params.pid, { ...pipelines, templates });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── PIPELINES ────────────────────────────────────────
app.get('/api/projects/:id/pipelines', auth, async (req, res) => {
  const { data } = await supabase.from('projects').select('pipelines').eq('id', req.params.id).single();
  res.json(data?.pipelines || DEFAULT_PIPELINES);
});

app.put('/api/projects/:id/pipelines', auth, async (req, res) => {
  const { data, error } = await supabase.from('projects').update({ pipelines: req.body }).eq('id', req.params.id).select('pipelines').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.pipelines);
});

// ─── ENTITY TYPES ─────────────────────────────────────
app.get('/api/projects/:pid/entity-types', auth, async (req, res) => {
  const { data } = await supabase.from('entity_types').select('*').eq('project_id', req.params.pid).order('created_at');
  const types = data || [];
  // Pipeline inheritance: walk up the parent chain for subtypes with no pipeline
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]));
  types.forEach(t => {
    if (t.parent_id && (!t.pipeline || t.pipeline.length === 0)) {
      let ancestor = typeMap[t.parent_id];
      while (ancestor) {
        if (ancestor.pipeline && ancestor.pipeline.length > 0) { t.pipeline = ancestor.pipeline; break; }
        ancestor = ancestor.parent_id ? typeMap[ancestor.parent_id] : null;
      }
    }
  });
  res.json(types);
});

app.post('/api/projects/:pid/entity-types', auth, async (req, res) => {
  const { data: project } = await supabase.from('projects').select('pipelines').eq('id', req.params.pid).single();
  const pipelines = project?.pipelines || DEFAULT_PIPELINES;
  const category = req.body.category || 'entity';
  const type = {
    id: uuidv4(), project_id: req.params.pid,
    name: req.body.name, category,
    color: req.body.color || '#6366f1',
    icon: req.body.icon || '📦',
    fields: req.body.fields || [],
    pipeline: req.body.pipeline || pipelines[category] || [],
    parent_id: req.body.parentId || null,
    created_at: new Date().toISOString(),
    created_by: req.session.userId
  };
  const { data, error } = await supabase.from('entity_types').insert(type).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, parentId: data.parent_id });
});

app.put('/api/projects/:pid/entity-types/:id', auth, async (req, res) => {
  const updates = {};
  ['name','category','color','icon','fields','pipeline','detail_blocks'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await supabase.from('entity_types').update(updates).eq('id', req.params.id).eq('project_id', req.params.pid).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, parentId: data.parent_id });
});

app.delete('/api/projects/:pid/entity-types/:id', auth, async (req, res) => {
  await supabase.from('entity_types').delete().eq('id', req.params.id).eq('project_id', req.params.pid);
  res.json({ ok: true });
});

// ─── TAGS ─────────────────────────────────────────────
app.get('/api/projects/:pid/tags', auth, async (req, res) => {
  const { data } = await supabase.from('tags').select('*').eq('project_id', req.params.pid);
  res.json(data || []);
});

app.post('/api/projects/:pid/tags', auth, async (req, res) => {
  const tag = { id: uuidv4(), project_id: req.params.pid, name: req.body.name, category: req.body.category || 'general', color: req.body.color || '#8b5cf6', description: req.body.description || '', created_at: new Date().toISOString() };
  const { data, error } = await supabase.from('tags').insert(tag).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/projects/:pid/tags/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('tags').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/projects/:pid/tags/:id', auth, async (req, res) => {
  await supabase.from('tags').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── ENTITIES ─────────────────────────────────────────
app.get('/api/projects/:pid/entities', auth, async (req, res) => {
  let query = supabase.from('entities').select('*').eq('project_id', req.params.pid);
  if (req.query.typeId) query = query.eq('type_id', req.query.typeId);
  if (req.query.environment) query = query.eq('environment', req.query.environment);
  if (req.query.search) query = query.ilike('name', `%${req.query.search}%`);
  const { data } = await query.order('updated_at', { ascending: false });
  res.json((data || []).map(e => ({ ...e, typeId: e.type_id })));
});

app.get('/api/projects/:pid/entities/:id', auth, async (req, res) => {
  const { data } = await supabase.from('entities').select('*').eq('id', req.params.id).eq('project_id', req.params.pid).single();
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ ...data, typeId: data.type_id });
});

app.post('/api/projects/:pid/entities', auth, async (req, res) => {
  const entity = {
    id: uuidv4(), project_id: req.params.pid,
    name: req.body.name, type_id: req.body.typeId,
    fields: req.body.fields || {}, tags: req.body.tags || [],
    nature: req.body.nature || null,
    status: req.body.status || 'draft',
    environment: req.body.environment || 'not_in_engine',
    pipeline: {}, pipeline_steps: {},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    created_by: req.session.userId, owned_by: req.session.userId
  };
  const { data, error } = await supabase.from('entities').insert(entity).select().single();
  if (error) return res.status(500).json({ error: error.message });
  logActivity(req.params.pid, req.session.userId, entity.id, 'created', `Created ${entity.name}`);
  res.json({ ...data, typeId: data.type_id });
});

app.put('/api/projects/:pid/entities/:id', auth, async (req, res) => {
  const { data: old } = await supabase.from('entities').select('*').eq('id', req.params.id).single();
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if (req.body.typeId) { updates.type_id = req.body.typeId; delete updates.typeId; }
  const { data, error } = await supabase.from('entities').update(updates).eq('id', req.params.id).eq('project_id', req.params.pid).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (old && req.body.environment && req.body.environment !== old.environment)
    logActivity(req.params.pid, req.session.userId, old.id, 'environment', `${old.name}: ${old.environment} → ${req.body.environment}`);
  if (old && req.body.status && req.body.status !== old.status)
    logActivity(req.params.pid, req.session.userId, old.id, 'status', `${old.name}: ${old.status} → ${req.body.status}`);
  res.json({ ...data, typeId: data.type_id });
});

app.delete('/api/projects/:pid/entities/:id', auth, async (req, res) => {
  await supabase.from('entities').delete().eq('id', req.params.id).eq('project_id', req.params.pid);
  res.json({ ok: true });
});

// ─── CROSS REFERENCES ─────────────────────────────────
app.get('/api/projects/:pid/references/:entityId', auth, async (req, res) => {
  const { data: entities } = await supabase.from('entities').select('id, name, fields').eq('project_id', req.params.pid);
  const targetId = req.params.entityId;
  const refs = [];
  (entities || []).forEach(e => {
    if (e.id === targetId) return;
    let found = false;
    Object.entries(e.fields || {}).forEach(([fieldId, val]) => {
      if (found) return;
      if (val === targetId) { refs.push({ entityId: e.id, name: e.name, fieldId, relType: 'reference' }); found = true; }
      else if (Array.isArray(val) && val.includes(targetId)) { refs.push({ entityId: e.id, name: e.name, fieldId, relType: 'list' }); found = true; }
      else if (Array.isArray(val) && val.some && val.some(r => r && r.entityId === targetId)) { refs.push({ entityId: e.id, name: e.name, fieldId, relType: 'loot_table' }); found = true; }
    });
  });
  res.json(refs);
});

// ─── TASKS ────────────────────────────────────────────
app.get('/api/projects/:pid/my-tasks', auth, async (req, res) => {
  const { data: tasks } = await supabase.from('tasks').select('*').eq('project_id', req.params.pid).eq('assignee_id', req.session.userId);
  const entityIds = [...new Set((tasks || []).map(t => t.entity_id))];
  const { data: entities } = entityIds.length ? await supabase.from('entities').select('id, name').in('id', entityIds) : { data: [] };
  res.json((tasks || []).map(t => ({ ...t, assigneeId: t.assignee_id, entityId: t.entity_id, stepId: t.step_id, stepName: t.step_name, assignedBy: t.assigned_by, entityName: entities?.find(e => e.id === t.entity_id)?.name || 'Unknown' })));
});

app.get('/api/projects/:pid/tasks', auth, async (req, res) => {
  let query = supabase.from('tasks').select('*').eq('project_id', req.params.pid);
  if (req.query.assigneeId) query = query.eq('assignee_id', req.query.assigneeId);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.dept) query = query.eq('dept', req.query.dept);
  if (req.query.entityId) query = query.eq('entity_id', req.query.entityId);
  const { data: tasks } = await query;
  const entityIds = [...new Set((tasks || []).map(t => t.entity_id))];
  const assigneeIds = [...new Set((tasks || []).map(t => t.assignee_id).filter(Boolean))];
  const [{ data: entities }, { data: users }] = await Promise.all([
    entityIds.length ? supabase.from('entities').select('id, name').in('id', entityIds) : Promise.resolve({ data: [] }),
    assigneeIds.length ? supabase.from('users').select('id, username').in('id', assigneeIds) : Promise.resolve({ data: [] })
  ]);
  res.json((tasks || []).map(t => ({ ...t, assigneeId: t.assignee_id, entityId: t.entity_id, stepId: t.step_id, stepName: t.step_name, entityName: entities?.find(e => e.id === t.entity_id)?.name || 'Unknown', assigneeName: users?.find(u => u.id === t.assignee_id)?.username || 'Unassigned' })));
});

app.post('/api/projects/:pid/tasks', auth, async (req, res) => {
  const roles = await getUserRoles(req.session.userId, req.params.pid);
  if (!isDirectorOrLead(roles)) return res.status(403).json({ error: 'Only directors and leads can assign tasks' });
  await supabase.from('tasks').delete().eq('entity_id', req.body.entityId).eq('step_id', req.body.stepId).eq('project_id', req.params.pid);
  const user = await getUser(req.session.userId);
  const task = { id: uuidv4(), project_id: req.params.pid, entity_id: req.body.entityId, step_id: req.body.stepId, step_name: req.body.stepName, dept: req.body.dept || '', assignee_id: req.body.assigneeId, due_date: req.body.dueDate || null, status: 'not_started', assigned_by: req.session.userId, assigned_by_name: user?.username || '', note: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('tasks').insert(task).select().single();
  if (error) return res.status(500).json({ error: error.message });
  logActivity(req.params.pid, req.session.userId, req.body.entityId, 'task_assigned', `${req.body.stepName} → ${(await getUser(req.body.assigneeId))?.username}`);
  res.json({ ...data, assigneeId: data.assignee_id, entityId: data.entity_id, stepId: data.step_id, stepName: data.step_name });
});

app.put('/api/projects/:pid/tasks/:id', auth, async (req, res) => {
  const { data: old } = await supabase.from('tasks').select('*').eq('id', req.params.id).single();
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (old && req.body.status && req.body.status !== old.status)
    logActivity(req.params.pid, req.session.userId, old.entity_id, 'task_status', `${old.step_name}: ${old.status} → ${req.body.status}`);
  res.json({ ...data, assigneeId: data.assignee_id, entityId: data.entity_id, stepId: data.step_id, stepName: data.step_name });
});

app.get('/api/projects/:pid/review-queue', auth, async (req, res) => {
  const roles = await getUserRoles(req.session.userId, req.params.pid);
  let query = supabase.from('tasks').select('*').eq('project_id', req.params.pid).eq('status', 'in_review');
  if (!roles.includes('director')) {
    const depts = [];
    if (roles.some(r => r.includes('art'))) depts.push('art');
    if (roles.some(r => r.includes('design'))) depts.push('design');
    if (roles.some(r => r.includes('program') || r.includes('dev'))) depts.push('programming');
    if (roles.some(r => r.includes('qa'))) depts.push('qa');
    if (roles.some(r => r.includes('audio'))) depts.push('audio');
    if (depts.length) query = query.in('dept', depts);
  }
  const { data: tasks } = await query;
  const entityIds = [...new Set((tasks || []).map(t => t.entity_id))];
  const assigneeIds = [...new Set((tasks || []).map(t => t.assignee_id).filter(Boolean))];
  const [{ data: entities }, { data: users }] = await Promise.all([
    entityIds.length ? supabase.from('entities').select('id, name').in('id', entityIds) : Promise.resolve({ data: [] }),
    assigneeIds.length ? supabase.from('users').select('id, username').in('id', assigneeIds) : Promise.resolve({ data: [] })
  ]);
  res.json((tasks || []).map(t => ({ ...t, assigneeId: t.assignee_id, entityId: t.entity_id, stepId: t.step_id, stepName: t.step_name, entityName: entities?.find(e => e.id === t.entity_id)?.name || 'Unknown', assigneeName: users?.find(u => u.id === t.assignee_id)?.username || 'Unknown' })));
});

// ─── COMMENTS ─────────────────────────────────────────
app.get('/api/comments/:entityId', auth, async (req, res) => {
  const { data } = await supabase.from('comments').select('*').eq('entity_id', req.params.entityId).order('created_at');
  res.json((data || []).map(c => ({ ...c, entityId: c.entity_id, authorId: c.author_id, authorName: c.author_name, parentId: c.parent_id || null })));
});

app.post('/api/comments', auth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const comment = { id: uuidv4(), entity_id: req.body.entityId, text: req.body.text, type: req.body.type || 'comment', author_id: req.session.userId, author_name: user?.username || 'Unknown', resolved: false, created_at: new Date().toISOString(), parent_id: req.body.parentId || null };
  const { data, error } = await supabase.from('comments').insert(comment).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, entityId: data.entity_id, authorId: data.author_id, authorName: data.author_name, parentId: data.parent_id || null });
});

app.put('/api/comments/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('comments').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/comments/:id', auth, async (req, res) => {
  const user = await getUser(req.session.userId);
  const { data: comment } = await supabase.from('comments').select('*').eq('id', req.params.id).single();
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.author_id !== req.session.userId && user?.account_type !== 'director') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  // Delete replies first, then the comment itself
  await supabase.from('comments').delete().eq('parent_id', req.params.id);
  const { error } = await supabase.from('comments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── ACTIVITY ─────────────────────────────────────────
app.get('/api/projects/:pid/activity', auth, async (req, res) => {
  let query = supabase.from('activity').select('*').eq('project_id', req.params.pid).order('created_at', { ascending: false }).limit(50);
  if (req.query.entityId) query = query.eq('entity_id', req.query.entityId);
  const { data } = await query;
  res.json(data || []);
});

// ─── STATS ────────────────────────────────────────────
app.get('/api/projects/:pid/stats', auth, async (req, res) => {
  const [{ data: entities }, { data: types }, { data: comments }, { data: tasks }] = await Promise.all([
    supabase.from('entities').select('id, name, type_id, status, environment, updated_at').eq('project_id', req.params.pid),
    supabase.from('entity_types').select('id, name, color, icon, category').eq('project_id', req.params.pid),
    supabase.from('comments').select('id, entity_id').in('entity_id', (await supabase.from('entities').select('id').eq('project_id', req.params.pid)).data?.map(e => e.id) || []),
    supabase.from('tasks').select('id, status, entity_id').eq('project_id', req.params.pid)
  ]);
  const statusCounts = {}, envCounts = {}, tasksByStatus = {};
  (entities || []).forEach(e => {
    statusCounts[e.status || 'draft'] = (statusCounts[e.status || 'draft'] || 0) + 1;
    envCounts[e.environment || 'not_in_engine'] = (envCounts[e.environment || 'not_in_engine'] || 0) + 1;
  });
  (tasks || []).forEach(t => { tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1; });
  res.json({
    totalEntities: entities?.length || 0, totalTypes: types?.length || 0,
    totalComments: comments?.length || 0, totalTasks: tasks?.length || 0,
    statusCounts, envCounts, tasksByStatus,
    byType: (types || []).map(t => ({ id: t.id, name: t.name, count: entities?.filter(e => e.type_id === t.id).length || 0, color: t.color, icon: t.icon, category: t.category })),
    recentEntities: [...(entities || [])].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 8).map(e => ({ ...e, typeId: e.type_id })),
    inIteration: (entities || []).filter(e => e.environment === 'iteration').map(e => ({ id: e.id, name: e.name, typeId: e.type_id })),
    blockedTasks: (tasks || []).filter(t => t.status === 'blocked')
  });
});

// ─── REPORTS ──────────────────────────────────────────
app.get('/api/projects/:pid/reports', auth, async (req, res) => {
  const [{ data: entities }, { data: types }, { data: tasks }, { data: users }, { data: activity }] = await Promise.all([
    supabase.from('entities').select('id, name, type_id, status, environment').eq('project_id', req.params.pid),
    supabase.from('entity_types').select('id, name, color, icon').eq('project_id', req.params.pid),
    supabase.from('tasks').select('*').eq('project_id', req.params.pid),
    supabase.from('users').select('id, username'),
    supabase.from('activity').select('*').eq('project_id', req.params.pid).order('created_at', { ascending: false }).limit(40)
  ]);
  const completionByType = (types || []).map(t => {
    const te = (entities || []).filter(e => e.type_id === t.id);
    const done = te.filter(e => e.status === 'done').length;
    return { id: t.id, name: t.name, icon: t.icon, color: t.color, total: te.length, done, pct: te.length ? Math.round(done / te.length * 100) : 0 };
  });
  const tasksByPerson = {};
  (tasks || []).forEach(t => {
    if (!t.assignee_id) return;
    if (!tasksByPerson[t.assignee_id]) {
      const u = users?.find(u => u.id === t.assignee_id);
      tasksByPerson[t.assignee_id] = { username: u?.username || 'Unknown', not_started: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0, total: 0 };
    }
    tasksByPerson[t.assignee_id].total++;
    tasksByPerson[t.assignee_id][t.status] = (tasksByPerson[t.assignee_id][t.status] || 0) + 1;
  });
  const envBreakdown = ['not_in_engine', 'zoo', 'gym', 'playable_build', 'iteration'].map(env => ({
    env, label: { not_in_engine: 'Not In Engine', zoo: 'ZOO', gym: 'GYM', playable_build: 'Playable Build', iteration: 'Iteration' }[env],
    count: (entities || []).filter(e => (e.environment || 'not_in_engine') === env).length
  }));
  const unassigned = [];
  (entities || []).forEach(e => {
    const type = types?.find(t => t.id === e.type_id);
    (type?.pipeline || []).forEach(step => {
      const task = tasks?.find(t => t.entity_id === e.id && t.step_id === step.id);
      if (!task) unassigned.push({ entityId: e.id, entityName: e.name, stepId: step.id, stepName: step.name, dept: step.dept });
    });
  });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  res.json({ completionByType, tasksByPerson: Object.values(tasksByPerson), envBreakdown, unassigned: unassigned.slice(0, 30), weekActivity: (activity || []).filter(a => a.created_at > weekAgo) });
});

// ─── FILE UPLOAD (Entity Icons) ──────────────────────────
app.post('/api/upload/icon', auth, (req, res) => {
  const contentType = req.headers['content-type'] || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : contentType.includes('webp') ? 'webp' : 'png';
  const filename = `icons/${uuidv4()}.${ext}`;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      // Try upload, create bucket if needed
      let { data, error } = await supabase.storage.from('hivemind-assets').upload(filename, buffer, { contentType, upsert: false });
      if (error && (error.message?.includes('not found') || error.statusCode === 404 || error.message?.includes('Bucket'))) {
        await supabase.storage.createBucket('hivemind-assets', { public: true });
        const r2 = await supabase.storage.from('hivemind-assets').upload(filename, buffer, { contentType, upsert: false });
        data = r2.data; error = r2.error;
      }
      if (error) return res.status(500).json({ error: error.message });
      const { data: urlData } = supabase.storage.from('hivemind-assets').getPublicUrl(filename);
      res.json({ url: urlData.publicUrl });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`\n🧠 Hivemind v0.4 (Supabase) → http://localhost:${PORT}\n`));
