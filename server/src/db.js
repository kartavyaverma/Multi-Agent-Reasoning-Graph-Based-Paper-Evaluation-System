import Datastore from '@seald-io/nedb';
import path from 'node:path';
import { config } from './config.js';

const open = (name) => {
  const ds = new Datastore({ filename: path.join(config.dataDir, 'db', `${name}.db`), autoload: true });
  ds.setAutocompactionInterval(60_000);
  return ds;
};

// Promise wrapper around the Mongo-like NeDB API (same collection names as the workflow guide).
const wrap = (ds) => ({
  find: (q = {}, { sort, limit, projection } = {}) => {
    let c = ds.findAsync(q, projection);
    if (sort) c = c.sort(sort);
    if (limit) c = c.limit(limit);
    return c;
  },
  findOne: (q, projection) => ds.findOneAsync(q, projection),
  insert: (d) => ds.insertAsync(d),
  update: (q, u, o) => ds.updateAsync(q, u, o),
  remove: (q, o) => ds.removeAsync(q, o),
  count: (q = {}) => ds.countAsync(q),
});

export const db = {
  users: wrap(open('users')),
  subjects: wrap(open('subjects')),
  tests: wrap(open('tests')),
  workflow_templates: wrap(open('workflow_templates')),
  workflows: wrap(open('workflows')),
  nodes: wrap(open('nodes')),
  results: wrap(open('results')),
};

export const now = () => Date.now();
