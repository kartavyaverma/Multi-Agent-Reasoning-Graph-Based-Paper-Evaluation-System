import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, now } from './db.js';
import { config } from './config.js';

export const authRouter = Router();

const sign = (u) => jwt.sign({ sub: u._id }, config.jwtSecret, { expiresIn: '14d' });
const pub = (u) => ({ id: u._id, name: u.name, email: u.email, institution: u.institution || '' });

authRouter.post('/signup', async (req, res) => {
  const { name, email, password, institution } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const e = email.trim().toLowerCase();
  if (await db.users.findOne({ email: e })) return res.status(409).json({ error: 'An account with this email already exists' });
  const u = await db.users.insert({ name: name.trim(), email: e, institution: institution?.trim() || '', password_hash: await bcrypt.hash(password, 10), created_at: now() });
  res.json({ token: sign(u), user: pub(u) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await db.users.findOne({ email: String(email || '').trim().toLowerCase() });
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: sign(u), user: pub(u) });
});

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token; // ?token= lets <iframe>/<img> load uploaded scans
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    const u = await db.users.findOne({ _id: sub });
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again' });
  }
}

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: pub(req.user) }));
