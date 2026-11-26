import { connectMongo, disconnectMongo } from '@tilcayo/core';
import { bootstrapTenancy, registerSchema } from '@tilcayo/auth';
import { Note } from '../models/Note.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';

class SetupError extends Error {}

async function main() {
  const email = process.env.TENANCY_SUPERADMIN_EMAIL;
  const password = process.env.TENANCY_SUPERADMIN_PASSWORD;
  const uri = process.env.MONGODB_URI;
  const missing = ['MONGODB_URI', 'TENANCY_SUPERADMIN_EMAIL', 'TENANCY_SUPERADMIN_PASSWORD'].filter(key => !process.env[key]?.trim());
  if (missing.length) throw new SetupError('Missing settings in api/.env: ' + missing.join(', ') + '. Fill them before running npm run tenancy:setup.');
  const credentials = registerSchema.safeParse({ name: 'Platform administrator', email, password });
  if (!credentials.success) {
    const fields = [...new Set(credentials.error.issues.map(issue => issue.path[0] === 'email' ? 'TENANCY_SUPERADMIN_EMAIL' : 'TENANCY_SUPERADMIN_PASSWORD'))];
    throw new SetupError('Invalid settings in api/.env: ' + fields.join(', ') + '. Use a valid email and a password of at least 8 characters and at most 72 UTF-8 bytes.');
  }
  try { await connectMongo(uri!, { serverSelectionTimeoutMS: 10000, autoIndex: false }); }
  catch { await disconnectMongo().catch(() => undefined); throw new SetupError('Could not connect to MongoDB. Check MONGODB_URI in api/.env, database availability and network access.'); }
  try {
    await bootstrapTenancy({ email: credentials.data.email, password: credentials.data.password });
    // Setup does not create a tenant or change ownership of existing records.
    // Driver access is limited to this offline setup command, not request handlers.
    for (const model of [Note, Order, Product]) {
      const indexes = await model.raw.collection.indexes().catch(error => { if (error.code === 26) return []; throw error; });
      for (const index of indexes) if (index.unique && index.name === 'sku_1' && Object.keys(index.key).length === 1) await model.raw.collection.dropIndex(index.name!);
      await model.raw.createIndexes();
    }
    console.log('Super Admin ready. Create tenants and assign administrators in Tenant administration on the main domain.');
  } finally { await disconnectMongo(); }
}
main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Tenancy setup failed. Check database permissions and existing account or workspace conflicts.');
  process.exitCode = 1;
});
